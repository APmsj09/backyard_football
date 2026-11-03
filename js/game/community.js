
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
