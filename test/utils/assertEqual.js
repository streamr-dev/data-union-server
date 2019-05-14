const assert = require("assert")
const BN = require("bn.js")
const ethers = require("ethers")

/**
 * Assert equality in web3 return value sense, modulo conversions to "normal" JS strings and numbers
 */
module.exports = function assertEqual(actual, expected) {
    // basic assert.equal comparison according to https://nodejs.org/api/assert.html#assert_assert_equal_actual_expected_message
    if (actual == expected) { return }  // eslint-disable-line eqeqeq
    // also handle arrays for convenience
    if (Array.isArray(actual) && Array.isArray(expected)) {
        assert.strictEqual(actual.length, expected.length, "Arrays have different lengths, supplied wrong number of expected values!")
        actual.forEach((a, i) => assertEqual(a, expected[i]))
        return
    }
    // use BigNumber's own comparator
    if (BN.isBN(expected)) {
        //assert.strictEqual(actual.cmp(expected), 0)
        assert.strictEqual(actual.toString(), expected.toString())
        return
    }
    // convert BigNumbers if expecting a number
    // NB: there's a reason BigNumbers are used! Keep your numbers small!
    // if the number coming back from contract is big, then expect a BigNumber to avoid this conversion
    if (typeof expected === "number") {
        assert.strictEqual(+actual, +expected)
        return
    }
    // convert hex bytes to string if expected thing looks like a string and not hex
    if (typeof expected === "string" && Number.isNaN(+expected) && !Number.isNaN(+actual)) {
        assert.strictEqual(ethers.utils.toUtf8String(actual), expected)
        return
    }
    // fail now with nice error if didn't hit the filters
    assert.equal(actual, expected)
}
