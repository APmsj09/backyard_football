import {
    assignCommunityServiceStaffHours,
    ensureAiStaffWorkPlan,
    ensureStaffAvailability,
    getStaffBehaviorTendency,
    getEffectiveStaffWorkHours
} from './staff.js';

// Community time is compressed into the nine playable weeks of each
// game year. Convert calendar-week cooldowns into that game timeline.
const COMMUNITY_GAME_WEEKS_PER_YEAR = 9;
const COMMUNITY_CALENDAR_WEEKS_PER_YEAR = 52;


export const COMMUNITY_FAVOR_CATALOGUE = Object.freeze([
    {
        id: 'yard_cleanup',
        category: 'household',
        title: 'Yard cleanup',
        requesterTypes: ['resident', 'player_parent'],
        descriptionTemplates: [
            'Help {requesterName} clear leaves and tidy up the yard.',
            '{requesterName} could use an extra pair of hands cleaning up the yard.'
        ],
        hoursRange: [1.5, 2.5],
        cashExpenseRange: [0, 5],
        seasons: ['spring', 'autumn'],
        rarityWeight: 10,
        repeatCooldownWeeks: 52,
        annualRepeat: false
    },
    {
        id: 'move_furniture',
        category: 'household',
        title: 'Help move some furniture',
        requesterTypes: ['resident', 'player_parent'],
        descriptionTemplates: [
            'Help {requesterName} move some furniture and boxes.',
            '{requesterName} needs help moving a few bulky items.'
        ],
        hoursRange: [1.5, 3],
        cashExpenseRange: [0, 0],
        seasons: ['all'],
        rarityWeight: 8,
        repeatCooldownWeeks: 52,
        annualRepeat: false
    },
    {
        id: 'garage_cleanup',
        category: 'household',
        title: 'Clean out a garage',
        requesterTypes: ['resident', 'player_parent'],
        descriptionTemplates: [
            'Help {requesterName} sort through a cluttered garage.',
            '{requesterName} has a garage that could use some organizing.'
        ],
        hoursRange: [2, 3],
        cashExpenseRange: [0, 5],
        seasons: ['spring', 'summer', 'autumn'],
        rarityWeight: 6,
        repeatCooldownWeeks: 52,
        annualRepeat: false
    },
    {
        id: 'furniture_assembly',
        category: 'household',
        title: 'Assemble some furniture',
        requesterTypes: ['resident', 'player_parent'],
        descriptionTemplates: [
            'Help {requesterName} put together some new furniture.',
            '{requesterName} could use help assembling a few pieces of furniture.'
        ],
        hoursRange: [1, 2.5],
        cashExpenseRange: [0, 0],
        seasons: ['all'],
        rarityWeight: 7,
        repeatCooldownWeeks: 52,
        annualRepeat: false
    },
    {
        id: 'unload_delivery',
        category: 'local_business',
        title: 'Unload a delivery',
        requesterTypes: ['local_business'],
        descriptionTemplates: [
            'Help {requesterName} unload and organize a delivery.',
            '{requesterName} has a delivery coming in and could use some help.'
        ],
        hoursRange: [1, 2],
        cashExpenseRange: [0, 0],
        seasons: ['all'],
        rarityWeight: 7,
        repeatCooldownWeeks: 40,
        annualRepeat: false
    },
    {
        id: 'store_cleanup',
        category: 'local_business',
        title: 'Help tidy up a local shop',
        requesterTypes: ['local_business'],
        descriptionTemplates: [
            'Help {requesterName} organize the back room and clean up the shop.',
            '{requesterName} could use help getting the shop ready for a busy period.'
        ],
        hoursRange: [1.5, 2.5],
        cashExpenseRange: [0, 0],
        seasons: ['all'],
        rarityWeight: 5,
        repeatCooldownWeeks: 52,
        annualRepeat: false
    },
    {
        id: 'event_setup',
        category: 'community_event',
        title: 'Set up a community event',
        requesterTypes: ['community_organization', 'school', 'neighborhood_group'],
        descriptionTemplates: [
            'Help {requesterName} set up tables, chairs, and supplies for an upcoming event.',
            '{requesterName} needs volunteers to help prepare for a community event.'
        ],
        hoursRange: [1, 2],
        cashExpenseRange: [0, 5],
        seasons: ['all'],
        rarityWeight: 8,
        repeatCooldownWeeks: 40,
        annualRepeat: true
    },
    {
        id: 'event_cleanup',
        category: 'community_event',
        title: 'Clean up after an event',
        requesterTypes: ['community_organization', 'school', 'neighborhood_group'],
        descriptionTemplates: [
            'Help {requesterName} pack up and clean the venue after an event.',
            '{requesterName} needs a few volunteers to help with the cleanup.'
        ],
        hoursRange: [1, 2],
        cashExpenseRange: [0, 0],
        seasons: ['all'],
        rarityWeight: 7,
        repeatCooldownWeeks: 40,
        annualRepeat: true
    },
    {
        id: 'sort_donations',
        category: 'community_service',
        title: 'Sort donated supplies',
        requesterTypes: ['community_organization', 'school'],
        descriptionTemplates: [
            'Help {requesterName} sort and organize donated supplies.',
            '{requesterName} has a collection of donations that needs organizing.'
        ],
        hoursRange: [1, 2.5],
        cashExpenseRange: [0, 0],
        seasons: ['all'],
        rarityWeight: 7,
        repeatCooldownWeeks: 26,
        annualRepeat: false
    },
    {
        id: 'community_center',
        category: 'community_service',
        title: 'Help at the community center',
        requesterTypes: ['community_organization'],
        descriptionTemplates: [
            'Help {requesterName} move supplies and organize the community center.',
            '{requesterName} could use some help getting the community center ready.'
        ],
        hoursRange: [1, 2],
        cashExpenseRange: [0, 5],
        seasons: ['all'],
        rarityWeight: 6,
        repeatCooldownWeeks: 40,
        annualRepeat: false
    },
    {
        id: 'park_cleanup',
        category: 'community_service',
        title: 'Clean up the neighborhood park',
        requesterTypes: ['neighborhood_group', 'community_organization'],
        descriptionTemplates: [
            'Join {requesterName} for a neighborhood park cleanup.',
            '{requesterName} is organizing volunteers to tidy up the local park.'
        ],
        hoursRange: [1, 2],
        cashExpenseRange: [0, 5],
        seasons: ['spring', 'summer', 'autumn'],
        rarityWeight: 7,
        repeatCooldownWeeks: 26,
        annualRepeat: true
    },
    {
        id: 'garden_help',
        category: 'household',
        title: 'Help with some garden work',
        requesterTypes: ['resident', 'player_parent'],
        descriptionTemplates: [
            'Help {requesterName} tidy up garden beds and move some garden waste.',
            '{requesterName} could use a hand with some ordinary garden maintenance.'
        ],
        hoursRange: [1, 2.5],
        cashExpenseRange: [0, 10],
        seasons: ['spring', 'summer'],
        rarityWeight: 6,
        repeatCooldownWeeks: 52,
        annualRepeat: false
    },
    {
        id: 'fundraiser_setup',
        category: 'community_event',
        title: 'Help with a local fundraiser',
        requesterTypes: ['community_organization', 'school'],
        descriptionTemplates: [
            'Help {requesterName} prepare tables and supplies for a local fundraiser.',
            '{requesterName} needs volunteers to get a fundraising event ready.'
        ],
        hoursRange: [1.5, 2.5],
        cashExpenseRange: [0, 5],
        seasons: ['all'],
        rarityWeight: 6,
        repeatCooldownWeeks: 40,
        annualRepeat: true
    },
    {
        id: 'community_painting',
        category: 'community_service',
        title: 'Freshen up a community room',
        requesterTypes: ['community_organization', 'school'],
        descriptionTemplates: [
            'Help {requesterName} paint and tidy up a community room.',
            '{requesterName} is organizing a small volunteer project to freshen up the room.'
        ],
        hoursRange: [2, 4],
        cashExpenseRange: [5, 20],
        seasons: ['spring', 'summer'],
        rarityWeight: 3,
        repeatCooldownWeeks: 104,
        annualRepeat: false
    },
    {
        id: 'donation_transport',
        category: 'community_service',
        title: 'Help move donated items',
        requesterTypes: ['community_organization', 'player_parent'],
        descriptionTemplates: [
            'Help {requesterName} move donated items to a local collection point.',
            '{requesterName} needs help sorting and transporting a batch of donated goods.'
        ],
        hoursRange: [1.5, 2.5],
        cashExpenseRange: [0, 10],
        seasons: ['all'],
        rarityWeight: 6,
        repeatCooldownWeeks: 40,
        annualRepeat: false
    },
    {
        id: 'field_storage',
        category: 'youth_sports',
        title: 'Help organize sports equipment storage',
        requesterTypes: ['youth_sports_group', 'school'],
        descriptionTemplates: [
            'Help {requesterName} organize and store shared sports equipment.',
            '{requesterName} needs a few volunteers to sort equipment and clear storage space.'
        ],
        hoursRange: [1, 2],
        cashExpenseRange: [0, 0],
        seasons: ['spring', 'autumn'],
        rarityWeight: 5,
        repeatCooldownWeeks: 40,
        annualRepeat: true
    },
    {
        id: 'field_setup',
        category: 'youth_sports',
        title: 'Help prepare a local playing field',
        requesterTypes: ['youth_sports_group', 'school'],
        descriptionTemplates: [
            'Help {requesterName} set up equipment and prepare a shared playing field.',
            '{requesterName} could use volunteers to get the local field ready for an event.'
        ],
        hoursRange: [1, 2],
        cashExpenseRange: [0, 5],
        seasons: ['spring', 'summer', 'autumn'],
        rarityWeight: 4,
        repeatCooldownWeeks: 40,
        annualRepeat: true
    }
].map(favor => Object.freeze({
    ...favor,
    requesterTypes: Object.freeze(favor.requesterTypes),
    descriptionTemplates: Object.freeze(favor.descriptionTemplates),
    hoursRange: Object.freeze(favor.hoursRange),
    cashExpenseRange: Object.freeze(favor.cashExpenseRange),
    seasons: Object.freeze(favor.seasons)
})));

export function getCommunityFavorDefinition(favorType) {
    return COMMUNITY_FAVOR_CATALOGUE.find(
        favor => favor.id === favorType
    ) || null;
}

export function createCommunityState() {
    return {
        version: 1,
        contacts: [],
        favors: [],
        teamReputations: {},
        nextContactId: 1,
        nextFavorId: 1
    };
}

export function ensureCommunityState(gameState) {
    if (!gameState || typeof gameState !== 'object') {
        return null;
    }

    if (
        !gameState.community ||
        typeof gameState.community !== 'object' ||
        Array.isArray(gameState.community)
    ) {
        gameState.community = createCommunityState();
    }

    const community = gameState.community;

    community.version = Math.max(
        1,
        Math.floor(Number(community.version) || 1)
    );

    if (!Array.isArray(community.contacts)) {
        community.contacts = [];
    }

    if (!Array.isArray(community.favors)) {
        community.favors = [];
    }

    if (
        !community.teamReputations ||
        typeof community.teamReputations !== 'object' ||
        Array.isArray(community.teamReputations)
    ) {
        community.teamReputations = {};
    }

    community.nextContactId = Math.max(
        1,
        Math.floor(Number(community.nextContactId) || 1)
    );

    community.nextFavorId = Math.max(
        1,
        Math.floor(Number(community.nextFavorId) || 1)
    );

    return community;
}

const COMMUNITY_FIRST_NAMES = [
    'Alex', 'Andrea', 'Brian', 'Casey', 'Chris',
    'Dana', 'David', 'Jamie', 'Jordan', 'Karen',
    'Kelly', 'Lisa', 'Mark', 'Morgan', 'Pat',
    'Robin', 'Sam', 'Taylor', 'Terry', 'Thomas',
    'Angela', 'Eric', 'Jennifer', 'Michael'
];

const COMMUNITY_LAST_NAMES = [
    'Adams', 'Baker', 'Bennett', 'Brooks', 'Campbell',
    'Carter', 'Clark', 'Collins', 'Cooper', 'Davis',
    'Edwards', 'Foster', 'Garcia', 'Harris', 'Hayes',
    'Jackson', 'Jenkins', 'Johnson', 'Kelly', 'Lewis',
    'Martin', 'Miller', 'Morgan', 'Nelson', 'Parker',
    'Reed', 'Rivera', 'Robinson', 'Scott', 'Smith',
    'Taylor', 'Thomas', 'Turner', 'Walker', 'Wilson'
];

const COMMUNITY_NEIGHBORHOODS = [
    'Northside',
    'West End',
    'Maple Hill',
    'Riverside',
    'Old Town',
    'Eastside'
];

const COMMUNITY_ORGANIZATION_SEEDS = [
    {
        type: 'local_business',
        organizationName: 'West End Hardware',
        role: 'shop owner'
    },
    {
        type: 'local_business',
        organizationName: 'Maple Street Market',
        role: 'store manager'
    },
    {
        type: 'local_business',
        organizationName: 'Cornerstone Auto Repair',
        role: 'shop owner'
    },
    {
        type: 'community_organization',
        organizationName: 'Maple Grove Community Center',
        role: 'community coordinator'
    },
    {
        type: 'community_organization',
        organizationName: 'Northside Community Pantry',
        role: 'volunteer coordinator'
    },
    {
        type: 'neighborhood_group',
        organizationName: 'Westside Neighborhood Association',
        role: 'neighborhood organizer'
    },
    {
        type: 'school',
        organizationName: 'Maple Grove School',
        role: 'school activities coordinator'
    },
    {
        type: 'youth_sports_group',
        organizationName: 'Community Youth Sports Association',
        role: 'sports volunteer'
    }
];

function getRandomCommunityItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function createCommunityContact(community, details) {
    const contact = {
        id: `contact_${community.nextContactId++}`,
        name: details.name,
        type: details.type,
        role: details.role || null,
        organizationName: details.organizationName || null,
        neighborhood: details.neighborhood ||
            getRandomCommunityItem(COMMUNITY_NEIGHBORHOODS),

        relatedPlayerIds: Array.isArray(details.relatedPlayerIds)
            ? [...details.relatedPlayerIds]
            : [],

        favorHistory: [],
        lastFavorGeneratedAt: null,
        lastFavorCompletedAt: null,
        nextFavorEligibleWeek: null
    };

    community.contacts.push(contact);

    return contact;
}

export function initializeCommunityContacts(gameState) {
    const community = ensureCommunityState(gameState);

    if (!community) return [];

    // Never regenerate an existing community.
    if (community.contacts.length > 0) {
        return community.contacts;
    }

    // Generate ordinary residents.
    const residentRoles = [
        'local resident',
        'retired neighbor',
        'homeowner',
        'longtime neighborhood resident'
    ];

    for (let i = 0; i < 12; i++) {
        const firstName = getRandomCommunityItem(
            COMMUNITY_FIRST_NAMES
        );

        const lastName = getRandomCommunityItem(
            COMMUNITY_LAST_NAMES
        );

        createCommunityContact(community, {
            name: `${firstName} ${lastName}`,
            type: 'resident',
            role: getRandomCommunityItem(residentRoles)
        });
    }

    // Generate local businesses and community organizations.
    for (const seed of COMMUNITY_ORGANIZATION_SEEDS) {
        const firstName = getRandomCommunityItem(
            COMMUNITY_FIRST_NAMES
        );

        const lastName = getRandomCommunityItem(
            COMMUNITY_LAST_NAMES
        );

        createCommunityContact(community, {
            name: `${firstName} ${lastName}`,
            type: seed.type,
            role: seed.role,
            organizationName: seed.organizationName
        });
    }

    return community.contacts;
}

const COMMUNITY_FAVOR_SIMILARITY_GROUPS = {
    yard_cleanup: 'outdoor_cleanup',
    garden_help: 'outdoor_cleanup',
    park_cleanup: 'outdoor_cleanup',

    move_furniture: 'moving_help',
    furniture_assembly: 'moving_help',

    garage_cleanup: 'general_cleanup',
    store_cleanup: 'general_cleanup',
    event_cleanup: 'general_cleanup',
    community_center: 'general_cleanup',

    unload_delivery: 'transport_help',
    donation_transport: 'transport_help',

    event_setup: 'event_support',
    fundraiser_setup: 'event_support',

    sort_donations: 'donation_sorting',
    community_painting: 'community_maintenance',

    field_storage: 'sports_facility',
    field_setup: 'sports_facility'
};

function getCommunityRandomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Converts real calendar weeks into the compressed community timeline.
 *
 * Long repeat intervals round upward so requests cannot recur sooner
 * than their intended calendar cooldown. Short contact cooldowns use
 * stochastic rounding to preserve their expected interval.
 */
function convertCalendarWeeksToCommunityWeeks(
    calendarWeeks,
    {
        stochastic = false
    } = {}
) {
    const value = Number(calendarWeeks);

    if (!Number.isFinite(value) || value <= 0) {
        return 1;
    }

    const gameWeeks =
        value *
        COMMUNITY_GAME_WEEKS_PER_YEAR /
        COMMUNITY_CALENDAR_WEEKS_PER_YEAR;

    let convertedWeeks;

    if (stochastic) {
        const wholeWeeks = Math.floor(gameWeeks);
        const fractionalWeek = gameWeeks - wholeWeeks;

        convertedWeeks = wholeWeeks + (
            Math.random() < fractionalWeek ? 1 : 0
        );
    } else {
        convertedWeeks = Math.ceil(gameWeeks);
    }

    return Math.max(1, convertedWeeks);
}

function getCommunityRandomAmount(range, decimalPlaces = 1) {
    if (!Array.isArray(range) || range.length < 2) return 0;

    const min = Number(range[0]);
    const max = Number(range[1]);

    if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;

    const value = min + Math.random() * (max - min);
    const multiplier = 10 ** decimalPlaces;

    return Math.round(value * multiplier) / multiplier;
}

function getCommunitySimilarityGroup(favorType) {
    return COMMUNITY_FAVOR_SIMILARITY_GROUPS[favorType] || favorType;
}

function hasOpenCommunityFavor(community, contactId) {
    const terminalStatuses = new Set([
        'completed',
        'partial',
        'unsuccessful',
        'cancelled',
        'expired'
    ]);

    return community.favors.some(favor =>
        String(favor.contactId) === String(contactId) &&
        !terminalStatuses.has(favor.status)
    );
}

function isCommunitySeasonEligible(definition, season) {
    if (!Array.isArray(definition.seasons) || definition.seasons.length === 0) {
        return true;
    }

    const currentSeason = String(season || '').toLowerCase();

    return definition.seasons.some(eligibleSeason =>
        String(eligibleSeason).toLowerCase() === currentSeason
    );
}

function canContactRequestCommunityFavor(
    contact,
    definition,
    community,
    absoluteWeek
) {
    if (!contact || !definition) return false;

    // A contact can only have one unresolved request at a time.
    if (hasOpenCommunityFavor(community, contact.id)) {
        return false;
    }

    // Prevent the same contact from repeatedly requesting help.
    if (
        Number.isFinite(contact.nextFavorEligibleWeek) &&
        absoluteWeek < contact.nextFavorEligibleWeek
    ) {
        return false;
    }

    const history = Array.isArray(contact.favorHistory)
        ? contact.favorHistory
        : [];

    const currentSimilarityGroup = getCommunitySimilarityGroup(
        definition.id
    );

    for (const previousFavor of history) {
        const previousWeek = Number(previousFavor.createdWeek);

        if (!Number.isFinite(previousWeek)) continue;

        const weeksSincePrevious = absoluteWeek - previousWeek;

        if (weeksSincePrevious < 0) continue;

        // The same kind of request cannot recur within 52 weeks.
        if (previousFavor.favorType === definition.id) {
            const calendarRepeatCooldown = Math.max(
                COMMUNITY_CALENDAR_WEEKS_PER_YEAR,
                Number(definition.repeatCooldownWeeks) ||
                    COMMUNITY_CALENDAR_WEEKS_PER_YEAR
            );

            const repeatCooldown =
                convertCalendarWeeksToCommunityWeeks(
                    calendarRepeatCooldown
                );

            if (weeksSincePrevious < repeatCooldown) {
                return false;
            }

            // Only explicitly approved annual activities can recur.
            if (!definition.annualRepeat) {
                return false;
            }
        }

        // Similar tasks from the same person need roughly three
        // calendar months between requests.
        const similarTaskCooldown =
            convertCalendarWeeksToCommunityWeeks(12);

        const previousSimilarityGroup = getCommunitySimilarityGroup(
            previousFavor.favorType
        );

        if (
            previousSimilarityGroup === currentSimilarityGroup &&
            weeksSincePrevious < similarTaskCooldown
        ) {
            return false;
        }
    }

    return true;
}

function selectWeightedCommunityCandidate(candidates) {
    const totalWeight = candidates.reduce(
        (total, candidate) => total + candidate.weight,
        0
    );

    if (totalWeight <= 0) return null;

    let roll = Math.random() * totalWeight;

    for (const candidate of candidates) {
        roll -= candidate.weight;

        if (roll <= 0) {
            return candidate;
        }
    }

    return candidates[candidates.length - 1] || null;
}

function createCommunityFavorRequest(
    community,
    contact,
    definition,
    absoluteWeek
) {
    const favorId = `favor_${community.nextFavorId++}`;

    const requesterName =
        contact.organizationName || contact.name;

    const templates = Array.isArray(definition.descriptionTemplates)
        ? definition.descriptionTemplates
        : [];

    const template = templates.length > 0
        ? getRandomCommunityItem(templates)
        : `${requesterName} could use some help with ${definition.title.toLowerCase()}.`;

    const description = String(template).replace(
        /\{requesterName\}/g,
        requesterName
    );

    const estimatedHours = getCommunityRandomAmount(
        definition.hoursRange,
        2
    );

    const estimatedCashExpense = getCommunityRandomAmount(
        definition.cashExpenseRange,
        1
    );

    const favor = {
        id: favorId,
        contactId: contact.id,
        requesterName,
        requesterType: contact.type,

        favorType: definition.id,
        category: definition.category,
        title: definition.title,
        description,

        estimatedHours,
        estimatedCashExpense,

        createdWeek: absoluteWeek,
        deadlineWeek: absoluteWeek + 2,

        status: 'open',

        acceptedByTeamId: null,
        acceptedWeek: null,

        completedWeek: null,
        outcome: null
    };

    community.favors.push(favor);

    contact.favorHistory.push({
        favorId,
        favorType: definition.id,
        createdWeek: absoluteWeek,
        completedWeek: null,
        status: 'open'
    });

    contact.lastFavorGeneratedAt = absoluteWeek;

    // Different requesters naturally have different gaps between requests.
    // Convert the 6–8 calendar-week interval into the compressed
    // football-season timeline, preserving some variation.
    const calendarContactCooldown =
        getCommunityRandomInteger(6, 8);

    const contactCooldown =
        convertCalendarWeeksToCommunityWeeks(
            calendarContactCooldown,
            {
                stochastic: true
            }
        );

    contact.nextFavorEligibleWeek =
        absoluteWeek + contactCooldown;

    return favor;
}

function getWeeklyCommunityRequestTarget(maxRequests) {
    const roll = Math.random();

    let target;

    if (roll < 0.50) {
        target = 0;
    } else if (roll < 0.82) {
        target = 1;
    } else if (roll < 0.96) {
        target = 2;
    } else {
        target = 3;
    }

    return Math.min(target, maxRequests);
}

/**
 * Generates shared community requests for the current week.
 *
 * absoluteWeek must be a monotonically increasing week number across
 * seasons, rather than the week number within the current season.
 */
export function generateCommunityFavorRequests(
    gameState,
    {
        absoluteWeek,
        season,
        maxRequests = 3
    } = {}
) {
    const community = ensureCommunityState(gameState);

    if (!community) return [];

    // Seed the persistent contact pool on the first request-generation
    // attempt. This is safe to call repeatedly because the initializer
    // never regenerates an existing contact population.
    if (community.contacts.length === 0) {
        initializeCommunityContacts(gameState);
    }

    if (!Number.isInteger(absoluteWeek) || absoluteWeek < 0) {
        return [];
    }

    if (!season) return [];

    const requestLimit = Math.max(
        0,
        Math.floor(Number(maxRequests) || 0)
    );

    if (requestLimit === 0) return [];

    // A week gets only one generation attempt, even when the random
    // request target is zero. Also prevent replaying an older week.
    const lastGeneratedWeek = Number(
        community.lastGeneratedAbsoluteWeek
    );

    if (
        community.lastGeneratedAbsoluteWeek != null &&
        Number.isInteger(lastGeneratedWeek) &&
        lastGeneratedWeek >= absoluteWeek
    ) {
        return [];
    }

    const requestTarget = getWeeklyCommunityRequestTarget(
        requestLimit
    );

    // Record the attempt even when no requests are generated.
    community.lastGeneratedAbsoluteWeek = absoluteWeek;

    if (requestTarget === 0) return [];

    const candidates = [];

    for (const contact of community.contacts) {
        if (!contact?.id || !contact.type) continue;

        for (const definition of COMMUNITY_FAVOR_CATALOGUE) {
            if (!definition.requesterTypes?.includes(contact.type)) {
                continue;
            }

            if (!isCommunitySeasonEligible(definition, season)) {
                continue;
            }

            if (
                !canContactRequestCommunityFavor(
                    contact,
                    definition,
                    community,
                    absoluteWeek
                )
            ) {
                continue;
            }

            candidates.push({
                contact,
                definition,
                weight: Math.max(
                    0,
                    Number(definition.rarityWeight) || 0
                )
            });
        }
    }

    const generated = [];
    const usedContactIds = new Set();

    while (generated.length < requestTarget && candidates.length > 0) {
        const availableCandidates = candidates.filter(candidate =>
            !usedContactIds.has(String(candidate.contact.id))
        );

        if (availableCandidates.length === 0) break;

        const selected = selectWeightedCommunityCandidate(
            availableCandidates
        );

        if (!selected) break;

        const favor = createCommunityFavorRequest(
            community,
            selected.contact,
            selected.definition,
            absoluteWeek
        );

        generated.push(favor);
        usedContactIds.add(String(selected.contact.id));
    }

    return generated;
}

function updateCommunityFavorHistory(contact, favor, updates = {}) {
    if (!contact || !favor) return;

    if (!Array.isArray(contact.favorHistory)) {
        contact.favorHistory = [];
    }

    const historyEntry = contact.favorHistory.find(entry =>
        String(entry.favorId) === String(favor.id)
    );

    if (!historyEntry) return;

    Object.assign(historyEntry, updates);
}

function getCommunityFavorAndContact(community, favorId) {
    const favor = community.favors.find(entry =>
        String(entry.id) === String(favorId)
    );

    if (!favor) return null;

    const contact = community.contacts.find(entry =>
        String(entry.id) === String(favor.contactId)
    );

    if (!contact) return null;

    return { favor, contact };
}

function applyCommunityFavorReputation(
    community,
    contact,
    favor,
    teamId,
    status,
    absoluteWeek
) {
    if (
        !community ||
        !contact ||
        !favor ||
        teamId == null ||
        favor.communityReputationApplied === true
    ) {
        return null;
    }

    const reputationChanges = {
        completed: {
            team: 2,
            contact: 4,
            counter: 'completedFavors'
        },
        partial: {
            team: 1,
            contact: 2,
            counter: 'partialFavors'
        },
        unsuccessful: {
            team: -2,
            contact: -4,
            counter: 'unsuccessfulFavors'
        }
    };

    const change = reputationChanges[status];

    if (!change) return null;

    const teamKey = String(teamId);

    if (
        !community.teamReputations ||
        typeof community.teamReputations !== 'object' ||
        Array.isArray(community.teamReputations)
    ) {
        community.teamReputations = {};
    }

    let teamReputation = community.teamReputations[teamKey];

    if (
        !teamReputation ||
        typeof teamReputation !== 'object' ||
        Array.isArray(teamReputation)
    ) {
        teamReputation = {
            score: 50,
            completedFavors: 0,
            partialFavors: 0,
            unsuccessfulFavors: 0,
            lastActivityWeek: null
        };

        community.teamReputations[teamKey] = teamReputation;
    }

    const currentTeamScore = Number(teamReputation.score);

    teamReputation.score = Math.max(
        0,
        Math.min(
            100,
            (
                Number.isFinite(currentTeamScore)
                    ? currentTeamScore
                    : 50
            ) + change.team
        )
    );

    teamReputation[change.counter] =
        Math.max(0, Number(teamReputation[change.counter]) || 0) + 1;

    teamReputation.lastActivityWeek = absoluteWeek;

    if (
        !contact.teamRelationships ||
        typeof contact.teamRelationships !== 'object' ||
        Array.isArray(contact.teamRelationships)
    ) {
        contact.teamRelationships = {};
    }

    let relationship = contact.teamRelationships[teamKey];

    if (
        !relationship ||
        typeof relationship !== 'object' ||
        Array.isArray(relationship)
    ) {
        relationship = {
            score: 50,
            completedFavors: 0,
            partialFavors: 0,
            unsuccessfulFavors: 0,
            lastActivityWeek: null
        };

        contact.teamRelationships[teamKey] = relationship;
    }

    const currentRelationshipScore = Number(relationship.score);

    relationship.score = Math.max(
        0,
        Math.min(
            100,
            (
                Number.isFinite(currentRelationshipScore)
                    ? currentRelationshipScore
                    : 50
            ) + change.contact
        )
    );

    relationship[change.counter] =
        Math.max(0, Number(relationship[change.counter]) || 0) + 1;

    relationship.lastActivityWeek = absoluteWeek;

    favor.communityReputationApplied = true;
    favor.communityReputationAppliedWeek = absoluteWeek;
    favor.communityReputationChange = change.team;
    favor.contactRelationshipChange = change.contact;

    return {
        teamReputation: teamReputation.score,
        contactRelationship: relationship.score
    };
}

/**
 * Expires requests that were never accepted before their deadline.
 *
 * Accepted requests are retained. If overdue, they remain assigned
 * to their team until explicitly completed or otherwise resolved.
 */
export function expireCommunityFavorRequests(gameState, absoluteWeek) {
    const community = ensureCommunityState(gameState);

    if (!community || !Number.isInteger(absoluteWeek)) {
        return [];
    }

    const expired = [];

    for (const favor of community.favors) {
        if (!favor) continue;

        if (
            favor.status === 'open' &&
            absoluteWeek > favor.deadlineWeek
        ) {
            favor.status = 'expired';
            favor.expiredWeek = absoluteWeek;

            const result = getCommunityFavorAndContact(
                community,
                favor.id
            );

            if (result) {
                updateCommunityFavorHistory(
                    result.contact,
                    favor,
                    {
                        status: 'expired',
                        expiredWeek: absoluteWeek
                    }
                );
            }

            expired.push(favor);
            continue;
        }

        if (
            favor.status === 'accepted' &&
            absoluteWeek > favor.deadlineWeek
        ) {
            favor.isOverdue = true;

            if (favor.overdueSinceWeek == null) {
                favor.overdueSinceWeek = favor.deadlineWeek + 1;
            }
        }
    }

    return expired;
}

/**
 * Assigns an open community request to one team.
 *
 * A request can have only one accepting team.
 */
export function acceptCommunityFavor(
    gameState,
    favorId,
    teamId,
    absoluteWeek
) {
    const community = ensureCommunityState(gameState);

    if (
        !community ||
        teamId == null ||
        !Number.isInteger(absoluteWeek)
    ) {
        return null;
    }

    // Resolve expired requests before checking availability.
    expireCommunityFavorRequests(gameState, absoluteWeek);

    const result = getCommunityFavorAndContact(
        community,
        favorId
    );

    if (!result) return null;

    const { favor, contact } = result;

    if (favor.status !== 'open') return null;

    if (absoluteWeek > favor.deadlineWeek) return null;

    const team = gameState.teams?.find(candidate =>
        candidate?.id != null &&
        String(candidate.id) === String(teamId)
    );

    if (!team || team.leagueType !== 'main') return null;

    const year = Number(gameState.year);
    const week = Number(gameState.currentWeek);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(week)
    ) {
        return null;
    }

    const staffAssignment = assignCommunityServiceStaffHours(
        team,
        favor.id,
        Number(favor.estimatedHours),
        year,
        week,
        gameState
    );

    if (!staffAssignment?.success) {
        return null;
    }

    favor.status = 'accepted';

    favor.assignedStaffId = staffAssignment.coachId;
    favor.assignedStaffName = staffAssignment.coachName;

    favor.staffAssignmentWeekKey = `${year}:${week}`;
    favor.staffAssignmentYear = year;
    favor.staffAssignmentWeek = week;

    favor.committedVolunteerHours = staffAssignment.requestedHours;
    favor.staffEffectiveVolunteerHours = Math.max(
        0,
        Number(staffAssignment.effectiveHours) || 0
    );

    favor.staffWorkResolved = false;

    favor.acceptedByTeamId = team.id;
    favor.acceptedByTeamName = team.name || null;
    favor.acceptedWeek = absoluteWeek;

    favor.committedCashExpense = favor.estimatedCashExpense;

    updateCommunityFavorHistory(
        contact,
        favor,
        {
            status: 'accepted',
            acceptedByTeamId: team.id,
            acceptedWeek: absoluteWeek,
            assignedStaffId: staffAssignment.coachId,
            assignedStaffName: staffAssignment.coachName,
            committedVolunteerHours: staffAssignment.requestedHours,
            staffEffectiveVolunteerHours:
                favor.staffEffectiveVolunteerHours,
            staffAssignmentWeekKey: `${year}:${week}`
        }
    );

    return favor;
}

/**
 * Estimates how heavily an AI team's coaches are already committed.
 *
 * Uses the same weekly availability and schedule constraints as the
 * shared staff-work system. This is an opportunity-cost estimate,
 * not a separate volunteer-hours limit.
 */
function getAiCommunityStaffWorkloadPressure(team) {
    const plan = team?.staffWorkPlan;

    if (!plan || !Array.isArray(plan.assignments)) {
        return 1;
    }

    const staffRecords = [
        ...(Array.isArray(team.coaches) ? team.coaches : []),
        ...Object.values(team.staff || {})
    ];

    const uniqueStaff = new Map();

    for (const staff of staffRecords) {
        if (!staff || staff.id == null) continue;

        if (staff.role && staff.role !== 'coach') continue;

        uniqueStaff.set(String(staff.id), staff);
    }

    const coaches = [...uniqueStaff.values()];

    if (coaches.length === 0) return 1;

    const planCapValue = Number(plan.weeklyHoursPerCoach);
    const planCap = Number.isFinite(planCapValue)
        ? Math.max(0, Math.min(40, planCapValue))
        : 40;

    let totalPressure = 0;

    for (const coach of coaches) {
        const availability = ensureStaffAvailability(coach);

        const weeklyHours = Math.max(
            0,
            Math.min(
                40,
                Number(availability?.weeklyHours) || 0
            )
        );

        const availableDays = Array.isArray(
            availability?.availableDays
        )
            ? availability.availableDays.filter(
                day => typeof day === 'string' && day.trim()
            )
            : [];

        const isFlexible =
            availability?.scheduleType === 'flexible' ||
            availableDays.includes('Flexible');

        const hoursPerDay =
            availability?.timeWindow === 'mixed' ? 6 : 4;

        const scheduleCapacity =
            !isFlexible && availableDays.length > 0
                ? availableDays.length * hoursPerDay
                : weeklyHours;

        const weeklyCapacity = Math.min(
            weeklyHours,
            scheduleCapacity,
            planCap
        );

        const requestedHours = plan.assignments
            .filter(assignment =>
                assignment &&
                String(assignment.coachId) === String(coach.id)
            )
            .reduce(
                (total, assignment) =>
                    total + Math.max(
                        0,
                        Number(assignment.hours) || 0
                    ),
                0
            );

        const pressure = weeklyCapacity > 0
            ? Math.min(1, requestedHours / weeklyCapacity)
            : 1;

        totalPressure += pressure;
    }

    return totalPressure / coaches.length;
}

function getAiCommunityCashCommitments(community, teamId) {
    return community.favors.reduce((total, favor) => {
        if (
            favor?.status !== 'accepted' ||
            String(favor.acceptedByTeamId) !== String(teamId)
        ) {
            return total;
        }

        const expense = Number(
            favor.committedCashExpense ??
            favor.estimatedCashExpense
        );

        return total + (
            Number.isFinite(expense)
                ? Math.max(0, expense)
                : 0
        );
    }, 0);
}

/**
 * Estimates whether an AI GM would accept a particular community request.
 *
 * The result is probabilistic. Personality, strategic priorities,
 * staff workload, time commitment, and cash availability all matter.
 */
function getAiCommunityFavorAcceptanceChance(
    team,
    favor,
    community,
    gameState
) {
    if (
        !team ||
        team.isPlayerControlled ||
        team.leagueType !== 'main' ||
        !favor
    ) {
        return 0;
    }

    const gm =
        team.aiGmProfile ||
        team.staff?.gm ||
        null;

    const archetypeId = String(
        gm?.managementArchetypeId || ''
    );

    const archetypePreferences = {
        neighborhood_builder: 0.30,
        culture_keeper: 0.18,
        film_room_rat: 0.02,
        deal_maker: 0.04,
        tactical_innovator: -0.02,
        win_now_gambler: -0.04
    };

    const archetypeAdjustment =
        archetypePreferences[archetypeId] || 0;

    const relationshipOrientation = gm
        ? getStaffBehaviorTendency(
            gm,
            'relationshipOrientation'
        )
        : 50;

    const riskTolerance = gm
        ? getStaffBehaviorTendency(
            gm,
            'riskTolerance'
        )
        : 50;

    const relationshipAdjustment =
        ((relationshipOrientation - 50) / 50) * 0.07;

    const riskAdjustment =
        ((riskTolerance - 50) / 50) * 0.025;

    // Existing community standing can influence an AI team's motivation.
    // Teams with weaker reputations have a modest incentive to rebuild trust.
    const teamKey = String(team.id);

    const rawTeamReputation = Number(
        community.teamReputations?.[teamKey]?.score
    );

    const teamReputation = Number.isFinite(rawTeamReputation)
        ? Math.max(0, Math.min(100, rawTeamReputation))
        : 50;

    const teamReputationAdjustment =
        ((50 - teamReputation) / 50) * 0.025;

    // A positive history with this specific requester makes the AI
    // somewhat more willing to help them again.
    const contact = community.contacts.find(entry =>
        String(entry.id) === String(favor.contactId)
    );

    const rawContactRelationship = Number(
        contact?.teamRelationships?.[teamKey]?.score
    );

    const contactRelationship = Number.isFinite(
        rawContactRelationship
    )
        ? Math.max(0, Math.min(100, rawContactRelationship))
        : 50;

    const contactRelationshipAdjustment =
        ((contactRelationship - 50) / 50) * 0.05;

    const estimatedHours = Math.max(
        0,
        Number(favor.estimatedHours) || 0
    );

    const estimatedExpense = Math.max(
        0,
        Number(favor.estimatedCashExpense) || 0
    );

    const balanceValue = Number(team.finances?.balance);

    const cashBalance = Number.isFinite(balanceValue)
        ? Math.max(0, balanceValue)
        : 0;

    const existingCashCommitments =
        getAiCommunityCashCommitments(
            community,
            team.id
        );

    const availableCash = Math.max(
        0,
        cashBalance - existingCashCommitments
    );

    // AI teams cannot commit to an expense they cannot reasonably afford.
    if (estimatedExpense > availableCash + 0.005) {
        return 0;
    }

    const workloadPressure =
        getAiCommunityStaffWorkloadPressure(team);

    const workloadPenalty = workloadPressure * 0.05;
    const timePenalty = estimatedHours * 0.012;

    const cashPenalty = availableCash > 0
        ? Math.min(
            0.08,
            (estimatedExpense / Math.max(5, availableCash)) * 0.08
        )
        : 0;

    let categoryAdjustment = 0;

    if (favor.category === 'youth_sports') {
        categoryAdjustment = 0.02;
    } else if (
        favor.category === 'community_event' ||
        favor.category === 'community_service'
    ) {
        categoryAdjustment = 0.01;
    }

    const baseChance = 0.08;

    const chance =
        baseChance +
        archetypeAdjustment +
        relationshipAdjustment +
        riskAdjustment +
        teamReputationAdjustment +
        contactRelationshipAdjustment +
        categoryAdjustment -
        workloadPenalty -
        timePenalty -
        cashPenalty;

    return Math.max(
        0.01,
        Math.min(0.65, chance)
    );
}

/**
 * Lets AI-controlled teams independently consider open community requests.
 *
 * Each AI team gets one decision attempt per request per week.
 * A request can still be reconsidered in a later week if it remains open.
 *
 * Requests accepted by an AI team use acceptCommunityFavor(), so they
 * consume the same staff-work budget as player-controlled teams.
 */
export function processAiCommunityFavorDecisions(
    gameState,
    absoluteWeek
) {
    const community = ensureCommunityState(gameState);

    if (
        !community ||
        !Array.isArray(gameState?.teams) ||
        !Number.isInteger(absoluteWeek) ||
        !Number.isInteger(Number(gameState.year)) ||
        !Number.isInteger(Number(gameState.currentWeek))
    ) {
        return {
            accepted: [],
            considered: 0,
            expired: []
        };
    }

    const expired = expireCommunityFavorRequests(
        gameState,
        absoluteWeek
    );

    const year = Number(gameState.year);
    const week = Number(gameState.currentWeek);

    const aiTeams = gameState.teams.filter(team =>
        team &&
        team.leagueType === 'main' &&
        !team.isPlayerControlled
    );

    const openFavors = community.favors
        .filter(favor =>
            favor?.status === 'open' &&
            absoluteWeek <= Number(favor.deadlineWeek)
        )
        .sort((a, b) =>
            Number(a.createdWeek) - Number(b.createdWeek)
        );

    const accepted = [];
    let considered = 0;

    for (const favor of openFavors) {
        if (!favor.aiConsideredByTeam) {
            favor.aiConsideredByTeam = {};
        }

        const candidates = [];

        for (const team of aiTeams) {
            const teamKey = String(team.id);

            if (
                Number(favor.aiConsideredByTeam[teamKey]) ===
                absoluteWeek
            ) {
                continue;
            }

            // Build the normal AI workload before evaluating the request.
            const workPlan = ensureAiStaffWorkPlan(
                team,
                gameState,
                year,
                week
            );

            if (!workPlan) continue;

            const chance = getAiCommunityFavorAcceptanceChance(
                team,
                favor,
                community,
                gameState
            );

            // Record the attempt so repeated weekly processing cannot
            // reroll the same team's decision during the same week.
            favor.aiConsideredByTeam[teamKey] = absoluteWeek;
            considered++;

            if (chance <= 0) continue;

            candidates.push({
                team,
                chance,
                tieBreak: Math.random()
            });
        }

        // Teams with stronger community interest get first consideration,
        // but a lower-priority team can still accept if the others decline.
        candidates.sort((a, b) =>
            b.chance - a.chance ||
            a.tieBreak - b.tieBreak
        );

        for (const candidate of candidates) {
            if (Math.random() >= candidate.chance) {
                continue;
            }

            const acceptedFavor = acceptCommunityFavor(
                gameState,
                favor.id,
                candidate.team.id,
                absoluteWeek
            );

            if (!acceptedFavor) continue;

            accepted.push({
                favorId: acceptedFavor.id,
                teamId: candidate.team.id,
                teamName: candidate.team.name || null
            });

            break;
        }
    }

    return {
        accepted,
        considered,
        expired
    };
}
/**
 * Resolves accepted community favors after their assigned staff work
 * has been processed for the corresponding week.
 *
 * Staff availability, schedule constraints, combined workload, and
 * reliability determine expected volunteer hours. A modest execution
 * variance allows otherwise similar assignments to have different outcomes.
 */
export function resolveCommunityFavorOutcomes(
    gameState,
    {
        year,
        week,
        absoluteWeek
    } = {}
) {
    const community = ensureCommunityState(gameState);

    if (
        !community ||
        !Number.isInteger(year) ||
        !Number.isInteger(week) ||
        !Number.isInteger(absoluteWeek)
    ) {
        return [];
    }

    const weekKey = `${year}:${week}`;
    const resolved = [];

    const acceptedFavors = community.favors.filter(favor =>
        favor?.status === 'accepted' &&
        favor.staffAssignmentYear === year &&
        favor.staffAssignmentWeek === week &&
        favor.staffWorkResolved !== true
    );

    for (const favor of acceptedFavors) {
        const team = gameState.teams?.find(candidate =>
            candidate?.id != null &&
            String(candidate.id) ===
                String(favor.acceptedByTeamId)
        );

        if (!team) continue;

        const assignment = (
            team.staffWorkPlan?.assignments || []
        ).find(item =>
            item &&
            item.task === 'communityService' &&
            String(item.favorId) === String(favor.id) &&
            String(item.coachId) ===
                String(favor.assignedStaffId) &&
            (
                item.weekKey === weekKey ||
                (
                    Number(item.year) === year &&
                    Number(item.week) === week
                )
            )
        );

        // Missing workload records cannot receive credit for work.
        // Resolve the commitment as unsuccessful rather than leaving
        // the accepted favor and its staff obligation permanently open.
        const assignmentMissing = !assignment;

        const assignedCoachId =
            assignment?.coachId ?? favor.assignedStaffId;

        const requestedHours = Math.max(
            0,
            Number(
                assignment?.hours ??
                favor.estimatedHours
            ) || 0
        );

        const effectiveHours = assignmentMissing
            ? 0
            : Math.max(
                0,
                getEffectiveStaffWorkHours(team, assignment) || 0
            );

        const staffRecords = [
            ...(Array.isArray(team.coaches) ? team.coaches : []),
            ...Object.values(team.staff || {})
        ];

        const assignedStaff = staffRecords.find(member =>
            member?.id != null &&
            String(member.id) === String(assignedCoachId)
        );

        const discipline = assignedStaff
            ? getStaffBehaviorTendency(
                assignedStaff,
                'discipline'
            )
            : 50;

        const workloadRatio = requestedHours > 0
            ? Math.min(1, effectiveHours / requestedHours)
            : 0;

        // Workload and reliability establish the expected delivery rate.
        // Execution variance and discipline introduce realistic uncertainty.
        const executionVariance =
            0.75 + Math.random() * 0.50;

        const disciplineFactor =
            0.90 + (discipline / 100) * 0.20;

        const deliveryRatio = Math.max(
            0,
            Math.min(
                1,
                workloadRatio *
                executionVariance *
                disciplineFactor
            )
        );

        const actualHours = Math.round(
            requestedHours * deliveryRatio * 100
        ) / 100;

        let status;
        let outcome;

        if (deliveryRatio >= 0.70) {
            status = 'completed';
            outcome = 'Completed the request';
        } else if (deliveryRatio >= 0.35) {
            status = 'partial';
            outcome = 'Made partial progress';
        } else {
            status = 'unsuccessful';
            outcome = 'Could not complete the request';
        }

        favor.status = status;
        favor.outcome = outcome;

        favor.resolvedWeek = absoluteWeek;
        favor.staffWorkResolved = true;
        favor.staffWorkResolvedWeekKey = weekKey;

        favor.staffEffectiveVolunteerHours = effectiveHours;
        favor.actualVolunteerHours = actualHours;

        favor.actualCashExpense = Math.round(
            Math.max(
                0,
                Number(
                    favor.committedCashExpense ??
                    favor.estimatedCashExpense
                ) || 0
            ) * 100
        ) / 100;

        favor.cashExpensePendingLedger =
            favor.actualCashExpense > 0;

        favor.cashExpenseLedgered =
            favor.actualCashExpense <= 0;

        favor.cashExpenseYear = year;
        favor.cashExpenseWeek = week;

        if (status === 'completed') {
            favor.completedWeek = absoluteWeek;
        } else if (status === 'partial') {
            favor.partiallyCompletedWeek = absoluteWeek;
        }

        const contact = community.contacts.find(contact =>
            String(contact.id) === String(favor.contactId)
        );

        if (contact) {
            if (status === 'completed') {
                contact.lastFavorCompletedAt = absoluteWeek;
            }

            contact.lastFavorResolvedAt = absoluteWeek;

            updateCommunityFavorHistory(
                contact,
                favor,
                {
                    status,
                    completedWeek:
                        status === 'completed'
                            ? absoluteWeek
                            : null,
                    resolvedWeek: absoluteWeek,
                    outcome,
                    actualVolunteerHours: actualHours,
                    staffEffectiveVolunteerHours: effectiveHours
                }
            );

            applyCommunityFavorReputation(
                community,
                contact,
                favor,
                team.id,
                status,
                absoluteWeek
            );
        }

        resolved.push({
            favorId: favor.id,
            teamId: team.id,
            teamName: team.name || null,
            status,
            outcome,
            requestedHours,
            actualHours,
            deliveryRatio
        });
    }

    return resolved;
}