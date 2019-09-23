/**
 * Find first item fulfilling the condition in a sorted array
 *   where all items to left of target don't fulfill condition, and all items to right do
 *   (so only sorted w.r.t. the condition)
 * @param {Array} array
 * @param {Function<Boolean>} condition evaluated on array items
 * @returns {Number} index of first first condition-fulfilling item
 */
module.exports = function bisectFindFirstIndex(array, condition) {
    // search range
    let left = 0
    let right = array.length
    while (left < right) {
        const mid = (left + right) >> 1
        if (condition(array[mid])) {
            right = mid
        } else {
            left = mid + 1
        }
    }
    return left
}
