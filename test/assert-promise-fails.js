const assert = require("assert")

module.exports = async function assertFails(promise, reason) {
    let failed = false
    try {
        await promise
    } catch (e) {
        failed = true
        if (reason) {
            assert.strictEqual(e.reason || e.message, reason)
        }
    }
    if (!failed) {
        throw new Error("Expected call to fail")
    }
}
