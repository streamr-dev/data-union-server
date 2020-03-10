const MonoplasmaMember = require("../../src/member")
const assert = require("assert")

describe("MonoplasmaMember", () => {
    it("should add revenue to initially undefined balance", () => {
        const m = new MonoplasmaMember("tester1", "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2")
        m.addRevenue(100)
        assert.strictEqual(m.earnings.toString(), "100")
    })
    it("should add revenue to initially defined balance", () => {
        const m = new MonoplasmaMember("tester1", "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", 100)
        m.addRevenue(100)
        assert.strictEqual(m.earnings.toString(), "200")
    })
    it("should initially be active", () => {
        const m = new MonoplasmaMember("tester1", "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2")
        assert.strictEqual(m.isActive(), true)
    })
    it("should allow active to be specified", () => {
        const m = new MonoplasmaMember("tester1", "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", 100, false)
        assert.strictEqual(m.isActive(), false, "should not be active")
    })
    it("should return correct object representation", () => {
        const m = new MonoplasmaMember("tester1", "b3428050ea2448ed2e4409be47e1a50ebac0b2d2", 100)
        const obj = {
            name: "tester1",
            address: "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2",
            earnings: "100",
            active: true
        }
        assert.deepStrictEqual(m.toObject(), obj)
    })
    it("should throw when invalid address", () => {
        assert.throws(() => new MonoplasmaMember("tester1", "0xbe47e1ac0b2d2"))
    })
})
