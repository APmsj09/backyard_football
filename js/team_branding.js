// js/team_branding.js
import { teamNames } from './data.js';

function createBrandCatalog(rows, prefix) {
    return Object.fromEntries(
        rows.map(([name, primaryColor, secondaryColor]) => {
            const slug = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');

            return [
                name,
                Object.freeze({
                    primaryColor,
                    secondaryColor,
                    alternatePrimaryColor: secondaryColor,
                    alternateSecondaryColor: primaryColor,
                    logoId: `logo-${prefix}-${slug}`
                })
            ];
        })
    );
}

// Every standard main-league team has a permanent identity.
const MAIN_TEAM_PALETTES = [
    ['Comets',     '#0F766E', '#FFFFFF'],
    ['Jets',       '#166534', '#FFFFFF'],
    ['Rockets',    '#C2410C', '#FFFFFF'],
    ['Sharks',     '#075985', '#E0F2FE'],
    ['Tigers',     '#EA580C', '#111827'],
    ['Lions',      '#A16207', '#111827'],
    ['Bears',      '#78350F', '#FDE68A'],
    ['Eagles',     '#047857', '#FFFFFF'],
    ['Hornets',    '#6D28D9', '#FDE047'],
    ['Bulldogs',   '#991B1B', '#FFFFFF'],
    ['Panthers',   '#111827', '#67E8F9'],
    ['Giants',     '#1D4ED8', '#FFFFFF'],
    ['Wolves',     '#475569', '#E2E8F0'],
    ['Vipers',     '#65A30D', '#111827'],
    ['Pythons',    '#0891B2', '#082F49'],
    ['Cobras',     '#BE123C', '#FFFFFF'],
    ['Scorpions',  '#92400E', '#FDE68A'],
    ['Spartans',   '#312E81', '#FACC15'],
    ['Cyclones',   '#1E40AF', '#CBD5E1'],
    ['Gladiators', '#52525B', '#FACC15'],
    ['Raptors',    '#4C1D95', '#A3E635'],
    ['Hawks',      '#B45309', '#111827'],
    ['Falcons',    '#0E7490', '#FFFFFF'],
    ['Rebels',     '#BE185D', '#FFFFFF']
];

export const MAIN_TEAM_BRANDING = Object.freeze(
    createBrandCatalog(MAIN_TEAM_PALETTES, 'main')
);

// These are the existing Pee-Wee team names.
// Keep them centralized here so the branding and team generator
// can use the same list.
export const YOUTH_TEAM_NAMES = Object.freeze([
    "Lil' Tykes",
    "Mini Monsters",
    "Sandlot Pups",
    "Junior Jets",
    "Tots",
    "Wildcats",
    "Little Legends",
    "Rookie Rockets",
    "Backyard Bandits",
    "Tiny Titans",
    "Playground Panthers",
    "Grassroots Giants",
    "Sidewalk Sharks",
    "Rookie Raccoons",
    "Little Lightning",
    "Sandlot Spartans",
    "Mini Mavericks",
    "Junior Jaguars",
    "Backyard Bears",
    "Playground Pros",
    "Rookie Rebels",
    "Little Comets",
    "Kickoff Cubs",
    "Endzone Eagles"
]);

const YOUTH_TEAM_PALETTES = [
    ["Lil' Tykes",              '#DB2777', '#FFF1F2'],
    ['Mini Monsters',           '#7C3AED', '#FAE8FF'],
    ['Sandlot Pups',            '#92400E', '#FEF3C7'],
    ['Junior Jets',             '#0284C7', '#E0F2FE'],
    ['Tots',                    '#EA580C', '#FFF7ED'],
    ['Wildcats',                '#15803D', '#DCFCE7'],
    ['Little Legends',          '#A16207', '#FEF08A'],
    ['Rookie Rockets',          '#DC2626', '#FEE2E2'],
    ['Backyard Bandits',        '#334155', '#F1F5F9'],
    ['Tiny Titans',             '#0F766E', '#CCFBF1'],
    ['Playground Panthers',     '#1F2937', '#BAE6FD'],
    ['Grassroots Giants',       '#166534', '#DCFCE7'],
    ['Sidewalk Sharks',         '#0369A1', '#E0F2FE'],
    ['Rookie Raccoons',         '#57534E', '#FAFAF9'],
    ['Little Lightning',        '#CA8A04', '#FEF08A'],
    ['Sandlot Spartans',        '#9F1239', '#FFE4E6'],
    ['Mini Mavericks',          '#4338CA', '#E0E7FF'],
    ['Junior Jaguars',          '#B45309', '#FEF3C7'],
    ['Backyard Bears',          '#78350F', '#FDE68A'],
    ['Playground Pros',         '#475569', '#E2E8F0'],
    ['Rookie Rebels',           '#A21CAF', '#F5D0FE'],
    ['Little Comets',           '#0891B2', '#CFFAFE'],
    ['Kickoff Cubs',            '#65A30D', '#ECFCCB'],
    ['Endzone Eagles',          '#1D4ED8', '#DBEAFE']
];

export const YOUTH_TEAM_BRANDING = Object.freeze(
    createBrandCatalog(YOUTH_TEAM_PALETTES, 'youth')
);

function normalizeTeamName(name) {
    return String(name || '')
        .replace(/^the\s+/i, '')
        .trim();
}

/**
 * Returns permanent branding for a team object or team name.
 */
export function getTeamBranding(teamOrName, leagueType = 'main') {
    const team = typeof teamOrName === 'object'
        ? teamOrName
        : null;

    const name = normalizeTeamName(
        team?.name ?? teamOrName
    );

    const isYouth =
        team?.leagueType === 'youth' ||
        team?.isYouth === true ||
        leagueType === 'youth';

    const catalog = isYouth
        ? YOUTH_TEAM_BRANDING
        : MAIN_TEAM_BRANDING;

    return catalog[name] || null;
}