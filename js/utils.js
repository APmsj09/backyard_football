/**
 * Gets a random element from an array.
 * @param {Array} arr - The array to pick from.
 * @returns {*} A random element from the array.
 */
export function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Gets a random integer between two values, inclusive.
 * @param {number} min - The minimum value.
 * @param {number} max - The maximum value.
 * @returns {number} A random integer.
 */
export function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

