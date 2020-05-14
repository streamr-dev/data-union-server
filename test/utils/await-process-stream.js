
/**
 * Resolves the promise once stream contains the target string
 * @param {Readable} stream to subscribe to
 * @param {string} target string to search
 */
async function untilStreamContains(stream, target) {
    return new Promise(done => {
        function handler(data) {
            if (data.includes(target)) {
                stream.off && stream.off("data", handler) // stream.off might be missing, perhaps Node version issue
                done(data.toString())
            }
        }
        stream.on("data", handler)
    })
}

/**
 * Resolves the promise once stream contains a match for target regex
 * @param {Readable} stream to subscribe to
 * @param {RegExp} regex to use for matching
 * @returns {Match} the regex match object
 */
async function untilStreamMatches(stream, regex) {
    return new Promise(done => {
        function check(buffer) {
            const data = buffer.toString()
            const match = data.match(regex)
            if (match) {
                stream.off && stream.off("data", check)
                done(match)
            }
        }
        stream.on("data", check)
    })
}

/**
 * Resolves the promise once stream matches given number times for target regex
 * @param {Readable} stream to subscribe to
 * @param {RegExp} regex to use for capture, should have EXACTLY ONE capture pattern and no "g"
 * @param {Number} count how many matches to collect
 * @returns {List<String>} list of 1st captures
 */
async function capture(stream, regex, count = 1) {
    let matches = []
    return new Promise(done => {
        function check(buffer) {
            const data = buffer.toString()
            const fullMatches = data.match(RegExp(regex, "g"))
            if (fullMatches) {
                const newMatches = fullMatches.map(s => s.match(regex)[1])
                matches = matches.concat(newMatches).slice(0, count)
                if (matches.length >= count) {
                    stream.off && stream.off("data", check)
                    done(matches)
                }
            }
        }
        stream.on("data", check)
    })
}


module.exports = {
    untilStreamContains,
    untilStreamMatches,
    capture,
}
