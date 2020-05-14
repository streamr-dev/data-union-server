const sleep = require("../../src/utils/sleep-promise")

/**
 * @callback UntilCondition
 * @returns {boolean} signifying if it should stop waiting and continue execution
 */
/**
 * Wait until a condition is true
 * @param {UntilCondition} condition wait until this callback function returns true
 * @param {number} [timeOutMs=10000] stop waiting after that many milliseconds
 * @param {number} [pollingIntervalMs=100] check condition between so many milliseconds
 */
async function until(condition, timeOutMs = 10000, pollingIntervalMs = 100) {
    let timeout = false
    setTimeout(() => { timeout = true }, timeOutMs)
    while (!condition()) {
        if (timeout) {
            throw new Error("timeout")
        }
        await sleep(pollingIntervalMs)
    }
    return condition()
}

module.exports = until
