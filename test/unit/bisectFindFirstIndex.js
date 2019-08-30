const assert = require("assert")
const bisectFindFirstIndex = require("../../src/utils/bisectFindFirstIndex")

describe("bisectFindFirstIndex array util", () => {
    it("works in small case", () => {
        const list = [67, 41, 42, 35, 34, 34, 1]
        const filter = x => x < 40
        const res = bisectFindFirstIndex(list, filter)
        assert.strictEqual(res, 3)
    })

    it("works in large case", () => {
        const list = Array(100000).fill(0).map((_, i)=>i)
        const filter = x => x >= 40000
        const res = bisectFindFirstIndex(list, filter)
        assert.strictEqual(res, 40000)
    })

    it("works also with empty input", () => {
        assert.strictEqual(bisectFindFirstIndex([], x => x < 4), 0)
    })

    it("works with no target items", () => {
        const list = [67, 34, 45, 35, 34, 34]
        const filter = x => x < 1
        const res = bisectFindFirstIndex(list, filter)
        assert.strictEqual(res, 6)
    })

    it("works with only target items", () => {
        const list = [67, 34, 45, 35, 34, 34]
        const filter = x => x > 1
        const res = bisectFindFirstIndex(list, filter)
        assert.strictEqual(res, 0)
    })
})