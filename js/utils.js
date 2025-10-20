// js/utils.js - A place for reusable helper functions.

/**
 * Gets a random item from an array.
 * @param {Array} arr The array to pick from.
 * @returns {*} A random item from the array.
 */
export const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Gets a random integer between two values (inclusive).
 * @param {number} min The minimum value.
 * @param {number} max The maximum value.
 * @returns {number} A random integer.
 */
export const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
