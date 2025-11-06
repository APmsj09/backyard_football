/**
 * Gets a random element from an array.
 * @param {Array} arr - The array to pick from.
 * @returns {*} A random element from the array.
 */
export function getRandom(arr) {
    if (!arr || arr.length === 0) return undefined;
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
    // Ensure min is not greater than max after flooring/ceiling
    if (min > max) {
        [min, max] = [max, min]; // Swap if necessary
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
}



/**
 * Converts total inches to a feet'inches" string format.
 * @param {number} totalInches - The height in inches.
 * @returns {string} The height formatted as X' Y". Returns '?' if input is invalid.
 */
export function formatHeight(totalInches) {
    if (typeof totalInches !== 'number' || totalInches <= 0) {
        return '?';
    }
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${feet}' ${inches}"`;
}