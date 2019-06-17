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
async function until(condition, timeOutMs=10000, pollingIntervalMs=100) {
    let timeout = false
    setTimeout(() => { timeout = true }, timeOutMs)
    while (!condition() && !timeout) {
        await sleep(pollingIntervalMs)
    }
    return condition()
}

/**
 * Resolves the promise once stream contains the target string
 * @param {Readable} stream to subscribe to
 * @param {string} target string to search
 */
async function untilStreamContains(stream, target) {
    return new Promise(done => {
        function handler(data) {
            if (data.indexOf(target) > -1) {
                stream.off("data", handler)
                done(data.toString())
            }
        }
        stream.on("data", handler)
    })
}

/**
 * Resolves the promise once stream contains a match for target regex
 * @param {Readable} stream to subscribe to
 * @param {string} target string to search
 */
async function untilStreamMatches(stream, regex) {
    return new Promise(done => {
        function check(buffer) {
            const data = buffer.toString()
            const match = data.match(regex)
            if (match) {
                stream.off("data", check)
                done(match)
            }
        }
        stream.on("data", check)
    })
}

module.exports = {
    until,
    untilStreamContains,
    untilStreamMatches,
}
