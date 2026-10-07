// js/game.js - Main Game Engine Hub

export * from './game/physics.js';
export * from './game/player.js';
export * from './game/state.js';
export * from './game/collisions.js';
export * from './game/ai.js';
export * from './game/depth_chart.js';
export { autoResetLineup, isPlayerViableForPosition, pruneUnnaturalDepthOrder } from './game/depth_chart.js';
export * from './game/season.js';
export * from './game/draft.js';
export * from './game/engine_helpers.js';
export * from './game/play_execution.js';
export * from './game/play_resolution.js';

import { getRosterObjects } from './game/state.js';
import { changeFormation } from './game/depth_chart.js';
export const getUIRosterObjects = getRosterObjects;
export const changeFormationSmart = changeFormation;
