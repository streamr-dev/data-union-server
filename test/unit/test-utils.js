const assert = require("assert")

const assertEqual = require("../utils/assertEqual")

const {
    until,
    untilStreamContains,
} = require("../utils/await-until")

const EventEmitter = require("events")
const sleep = require("../../src/utils/sleep-promise")

// simulate what etherlime provides (?)
//global.assert = require("assert")

describe("Test help utilities", () => {
    describe("assertEqual", () => {
        it("matches numbers", () => {
            assertEqual(1, "1")
            assert.throws(() => assertEqual(1, 2), "expected 1 to equal 2")
        })
        it("matches strings", () => {
            assertEqual("0x74657374", "test")
            assertEqual("0x74657374746573747465737474657374", "testtesttesttest")
            assert.throws(() => assertEqual("0x74657374", "jest"), "expected 'test' to equal 'jest'")
        })
        it("won't convert response to string if address is expected", () => {
            assertEqual("0x7465737474657374746573747465737474657374", "0x7465737474657374746573747465737474657374")
            assertEqual("0x7465737474657374746573747465737474657374", "testtesttesttesttest")
        })
    })

    describe("await-until", () => {
        it("waits until condition is true", async () => {
            const start = +new Date()
            let done = false
            setTimeout(() => { done = true }, 10)
            assert(!done)
            assert(+new Date() - start < 9)
            const ret = await until(() => done)
            assert(done)
            assert(ret)
            assert(+new Date() - start > 9)
            assert(+new Date() - start < 900)
        })
        it("waits until timeout", async () => {
            const start = +new Date()
            let done = false
            assert(!done)
            assert(+new Date() - start < 9)
            await assert.rejects(until(() => done, 100, 10), { message: "timeout" })
            assert(!done)
            assert(+new Date() - start > 90)
            assert(+new Date() - start < 900)
        })
        it("untilStreamContains", async () => {
            const stream = new EventEmitter()
            let done = false
            untilStreamContains(stream, "DONE").then(() => {
                done = true
            })
            await sleep(1)
            assert(!done)
            stream.emit("data", "test")
            await sleep(1)
            assert(!done)
            stream.emit("data", "lol DONE")
            await sleep(1)
            assert(done)
            stream.emit("data", "test again")
            await sleep(1)
            assert(done)
        })
    })
})
