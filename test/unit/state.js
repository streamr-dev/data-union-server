const os = require("os")
const path = require("path")
const assert = require("assert")
const crypto = require("crypto")
const { utils: { getAddress, BigNumber }} = require("ethers")

const now = require("../../src/utils/now")
const MonoplasmaState = require("../../src/state")

// this is a unit test, but still it's better to use the "real" file store and not mock it,
//   since we DO check that the correct values actually come out of it. Mock would be almost as complex as the real thing.
const log = require("debug")("Streamr::CPS::test::unit::state")
const tmpDir = path.join(os.tmpdir(), `monoplasma-test-${+new Date()}`)
const FileStore = require("../../src/fileStore")
const fileStore = new FileStore(tmpDir, log)
const admin = "0x0000000000000000000000000000000000123564"

describe("MonoplasmaState", () => {
    it("should return member passed to constructor and then remove it successfully", () => {
        const plasmaAdmin = new MonoplasmaState(0, [{
            address: "0xfF019d79C31114c811e68e68C9863966F22370ef",
            earnings: 10
        }], fileStore, admin, 0)
        assert.deepStrictEqual(plasmaAdmin.getMembers(), [{
            address: "0xfF019d79C31114c811e68e68C9863966F22370ef",
            earnings: "10",
            active: true,
        }])
        plasmaAdmin.removeMember("0xfF019d79C31114c811e68e68C9863966F22370ef")
        assert.deepStrictEqual(plasmaAdmin.getMembers(), [])
    })

    it("should return correct members and member count", () => {
        const plasma = new MonoplasmaState(0, [], fileStore, admin, 0)
        plasma.addMember("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", "tester1")
        plasma.addMember("0xE5019d79c3Fc34c811E68e68c9Bd9966F22370eF", "tester2")
        plasma.addRevenue(100)
        assert.deepStrictEqual(plasma.getMemberCount(), { total: 2, active: 2, inactive: 0 })
        assert.deepStrictEqual(plasma.getMembers(), [
            {"address": "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", "earnings": "50", "name": "tester1", active: true},
            {"address": "0xE5019d79c3Fc34c811E68e68c9Bd9966F22370eF", "earnings": "50", "name": "tester2", active: true},
        ])
        plasma.removeMember("0xE5019d79c3Fc34c811E68e68c9Bd9966F22370eF")
        plasma.addRevenue(100)
        assert.deepStrictEqual(plasma.getMemberCount(), { total: 2, active: 1, inactive: 1 })
        assert.deepStrictEqual(plasma.getMembers(), [
            {"address": "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", "earnings": "150", "name": "tester1", active: true},
        ])
    })

    it("should not crash with large number of members", function () {
        this.timeout(20000)
        const initialMembers = []
        while (initialMembers.length < 200000) {
            initialMembers.push({
                address: getAddress(`0x${crypto.randomBytes(20).toString("hex")}`),
                earnings: 0,
            })
        }
        const plasma = new MonoplasmaState(0, initialMembers, fileStore, admin, 0)
        plasma.addRevenue(100)
    })

    it("should distribute earnings correctly", () => {
        const initialMembers = []
        while (initialMembers.length < 100) {
            initialMembers.push({
                address: `0x${crypto.randomBytes(20).toString("hex")}`,
                earnings: 0,
            })
        }
        const plasma = new MonoplasmaState(0, initialMembers, fileStore, admin, 0)
        assert(plasma.getMembers().every((m) => (
            m.earnings === "0"
        )), "all members should have zero earnings")

        // minimum amount of revenue that will result in members receiving earnings
        const revenue = initialMembers.length
        plasma.addRevenue(revenue)
        assert(plasma.getMembers().every((m) => (
            m.earnings === "1"
        )), "all members should have 1 earnings")

        assert.equal(plasma.getTotalRevenue(), revenue, "total revenue should be what was added")

        // add more revenue
        plasma.addRevenue(revenue)

        assert(plasma.getMembers().every((m) => (
            m.earnings === "2"
        )), "all members should have 2 earnings")
        assert.equal(plasma.getTotalRevenue(), revenue * 2, "total revenue should be what was added")
    })

    it("does not give earnings if added revenue < members.length", () => {
        // if the shared revenue isn't > 0 then it's burned
        // expected behaviour and isn't significant due to
        // amount burned being negligable e.g. $0.000000000000000001
        const initialMembers = []
        while (initialMembers.length < 100) {
            initialMembers.push({
                address: `0x${crypto.randomBytes(20).toString("hex")}`,
                earnings: 0,
            })
        }
        const plasma = new MonoplasmaState(0, initialMembers, fileStore, admin, 0)
        assert(plasma.getMembers().every((m) => (
            m.earnings === "0"
        )), "all members should have zero earnings")
        // largest amount of revenue that can be added that will result in no earnings.
        const revenue = initialMembers.length - 1
        plasma.addRevenue(revenue)
        assert(plasma.getMembers().every((m) => (
            m.earnings === "0"
        )), "all members should still have 0 earnings")
        // note total revenue may not equal total member earnings due to precision loss
        assert.equal(plasma.getTotalRevenue(), revenue, "total revenue should be what was added")

        // add more revenue that will be burned
        plasma.addRevenue(revenue)
        assert(plasma.getMembers().every((m) => (
            m.earnings === "0"
        )), "all members should still have 0 earnings")

        assert.equal(plasma.getTotalRevenue(), revenue * 2, "total revenue should be what was added")
    })

    it("should remember past blocks' earnings", async () => {
        const plasma = new MonoplasmaState(0, [], fileStore, admin, 0)
        plasma.addMember("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", "tester1")
        plasma.addMember("0xE5019d79c3Fc34c811E68e68c9Bd9966F22370eF", "tester2")
        plasma.addRevenue(100)
        await plasma.storeBlock(3, now())
        plasma.addRevenue(100)
        await plasma.storeBlock(5, now())
        plasma.addRevenue(100)
        plasma.addRevenue(100)
        await plasma.storeBlock(7, now())
        plasma.addRevenue(100)
        const m = await plasma.getMemberAt("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", 3)
        assert.strictEqual("50", m.earnings)
        assert.strictEqual("100", (await plasma.getMemberAt("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", 5)).earnings)
        assert.strictEqual("200", (await plasma.getMemberAt("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", 7)).earnings)
        assert.strictEqual("250", (await plasma.getMember("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2")).earnings)
    })
    /* TODO: fix this test; it's ok to wait until monoplasma 0.2 lands, because it will again jumble the proof literals
    it("should remember past blocks' proofs", async () => {
        const plasma = new MonoplasmaState(0, [], fileStore, admin, 0)
        plasma.addMember("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", "tester1")
        plasma.addMember("0xE5019d79c3Fc34c811E68e68c9Bd9966F22370eF", "tester2")
        plasma.addRevenue(100)
        await plasma.storeBlock(10, now())
        plasma.addRevenue(100)
        await plasma.storeBlock(12, now())
        plasma.addRevenue(100)
        plasma.addRevenue(100)
        await plasma.storeBlock(15, now())
        plasma.addRevenue(100)
        assert.deepStrictEqual(await plasma.getProofAt("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", 10), ["0x8620ab3c4df51cebd7ae1cd533c8824220db518d2a143e603e608eab62b169f7", "0x30b397c3eb0e07b7f1b8b39420c49f60c455a1a602f1a91486656870e3f8f74c"])
        assert.deepStrictEqual(await plasma.getProofAt("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", 12), ["0x8620ab3c4df51cebd7ae1cd533c8824220db518d2a143e603e608eab62b169f7", "0x1c3d277e4a94f6fc647ae9ffc2176165d8b90bf954f64fa536b6beedb34301a3"])
        assert.deepStrictEqual(await plasma.getProofAt("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", 15), ["0x8620ab3c4df51cebd7ae1cd533c8824220db518d2a143e603e608eab62b169f7", "0xce54ad18b934665680ccc22f7db77ede2144519d5178736111611e745085dec6"])
        assert.deepStrictEqual(await plasma.getProof("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2"), ["0x8620ab3c4df51cebd7ae1cd533c8824220db518d2a143e603e608eab62b169f7", "0x91360deed2f511a8503790083c6de21efbb1006b460d5024863ead9de5448927"])
    })
    */
    // The idea of this test is to make sure the merkletrees are cached between getProofAt queries
    //   so that the tree isn't recalculated every time
    it("should perform fine with LOTS of queries of recent past blocks' proofs", async () => {
        const initialMembers = []
        while (initialMembers.length < 1000) {
            initialMembers.push({
                address: getAddress(`0x${crypto.randomBytes(20).toString("hex")}`),
                earnings: 0,
            })
        }
        const plasma = new MonoplasmaState(0, initialMembers, fileStore, admin, 0)
        plasma.addRevenue(100)
        await plasma.storeBlock(100, now())
        plasma.addRevenue(100)
        await plasma.storeBlock(101, now())
        plasma.addRevenue(100)
        plasma.addRevenue(100)
        await plasma.storeBlock(102, now())
        plasma.addRevenue(100)

        const startTime = Date.now()
        for (let i = 0; i < 1000; i++) {
            const bnum = 100 + i % 3
            const { address } = initialMembers[(50 * i) % initialMembers.length]
            await plasma.getProofAt(address, bnum)
            const timeTaken = Date.now() - startTime
            assert(timeTaken < 5000, "too slow!")
        }
    })

    it("should give revenue to adminAccount if no members present", async () => {
        const plasma = new MonoplasmaState(0, [], fileStore, "0x1234567890123456789012345678901234567890", 0)
        plasma.addRevenue(100)
        assert.strictEqual((await plasma.getMember("0x1234567890123456789012345678901234567890")).earnings, "100")
    })
    it("should give no revenue to adminAccount if members present", async () => {
        const plasma = new MonoplasmaState(0, [], fileStore, "0x1234567890123456789012345678901234567890", 0)
        plasma.addMember("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", "tester1")
        plasma.addRevenue(100)
        assert.strictEqual((await plasma.getMember("0x1234567890123456789012345678901234567890")).earnings, "0")
    })

    describe("changing the admin fee", () => {
        it("should accept valid values", () => {
            const plasma = new MonoplasmaState(0, [], fileStore, admin, 0)
            plasma.setAdminFeeFraction(0.3)
            assert.strictEqual(plasma.adminFeeFraction.toString(), "300000000000000000")
            plasma.setAdminFeeFraction("400000000000000000")
            assert.strictEqual(plasma.adminFeeFraction.toString(), "400000000000000000")
            plasma.setAdminFeeFraction(new BigNumber("500000000000000000"))
            assert.strictEqual(plasma.adminFeeFraction.toString(), "500000000000000000")
        })
        it("should not accept numbers from wrong range", () => {
            const plasma = new MonoplasmaState(0, [], fileStore, admin, 0)
            assert.throws(() => plasma.setAdminFeeFraction(-0.3))
            assert.throws(() => plasma.setAdminFeeFraction("-400000000000000000"))
            assert.throws(() => plasma.setAdminFeeFraction(new BigNumber("-500000000000000000")))
            assert.throws(() => plasma.setAdminFeeFraction(1.3))
            assert.throws(() => plasma.setAdminFeeFraction("1400000000000000000"))
            assert.throws(() => plasma.setAdminFeeFraction(new BigNumber("1500000000000000000")))
        })
        it("should not accept bad values", () => {
            const plasma = new MonoplasmaState(0, [], fileStore, admin, 0)
            assert.throws(() => plasma.setAdminFeeFraction("bad hex"))
            assert.throws(() => plasma.setAdminFeeFraction(""))
            assert.throws(() => plasma.setAdminFeeFraction({}))
            assert.throws(() => plasma.setAdminFeeFraction(plasma))
            assert.throws(() => plasma.setAdminFeeFraction())
        })
    })

    describe("getMemberApi", () => {
        let plasma
        beforeEach(() => {
            const plasmaAdmin = new MonoplasmaState(0, [], fileStore, admin, 0)
            plasmaAdmin.addMember("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", "tester1")
            plasmaAdmin.addMember("0xE5019d79c3Fc34c811E68e68c9Bd9966F22370eF", "tester2")
            plasmaAdmin.addRevenue(100)
            plasma = plasmaAdmin.getMemberApi()
        })
        it("has all read-only functions", async () => {
            assert.deepStrictEqual(plasma.getMembers(), [{
                address: "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2",
                earnings: "50",
                name: "tester1",
                active: true
            }, {
                address: "0xE5019d79c3Fc34c811E68e68c9Bd9966F22370eF",
                earnings: "50",
                name: "tester2",
                active: true
            }])
            /* TODO: fix this test; it's ok to wait until monoplasma 0.2 lands, because it will again jumble the proof literals
            assert.deepStrictEqual(await plasma.getMember("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2"), {
                name: "tester1",
                address: "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2",
                earnings: "50",
                proof: ["0x8620ab3c4df51cebd7ae1cd533c8824220db518d2a143e603e608eab62b169f7", "0x30b397c3eb0e07b7f1b8b39420c49f60c455a1a602f1a91486656870e3f8f74c"],
                active: true,
            })
            assert.strictEqual(await plasma.getRootHash(), "0xe259a647fd9c91d31a98daa8185e28181d20ea0aeb9253718b10fcb074794582")
            assert.deepStrictEqual(
                await plasma.getProof("0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2"),
                ["0x8620ab3c4df51cebd7ae1cd533c8824220db518d2a143e603e608eab62b169f7", "0x30b397c3eb0e07b7f1b8b39420c49f60c455a1a602f1a91486656870e3f8f74c"],
            )
            */
        })
        it("doesn't have any write functions", () => {
            assert.strictEqual(plasma.addMember, undefined)
            assert.strictEqual(plasma.removeMember, undefined)
            assert.strictEqual(plasma.addRevenue, undefined)
            assert.strictEqual(plasma.getMemberApi, undefined)
        })
    })
})
