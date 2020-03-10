const assert = require("assert")

const MonoplasmaMember = require("../../src/member")
const MerkleTree = require("../../src/merkletree")
const { hashLeaf, hashCombined } = MerkleTree

// calculate the root hash using the path (sync with BalanceVerifier.sol:calculateRootHash)
function calculateRootHash(memberHash, others) {
    let root = memberHash
    for (let i = 0; i < others.length; i += 1) {
        const other = others[i]
        if (root < other) {
            root = hashCombined(root, other)
        } else {
            root = hashCombined(other, root)
        }
    }
    return root
}

describe("Merkle tree", () => {
    const a = new MonoplasmaMember("A", "0x1f428050ea2448ed2e4409be47e1a50ebac0b2d2", 3)
    const b = new MonoplasmaMember("B", "0x2f428050ea2448ed2e4409be47e1a50ebac0b2d2", 4)
    const c = new MonoplasmaMember("C", "0x3f428050ea2448ed2e4409be47e1a50ebac0b2d2", 5)
    const d = new MonoplasmaMember("D", "0x4f428050ea2448ed2e4409be47e1a50ebac0b2d2", 6)
    const e = new MonoplasmaMember("E", "0x5f428050ea2448ed2e4409be47e1a50ebac0b2d2", 7)
    const testSmall = n => [a, b, c, d, e].slice(0, n)

    function buildValidAddress(i) {
        const nbDigits = i.toString().length
        const rest = "0f428050ea2448ed2e4409be47e1a50ebac0b2d2".substr(nbDigits)
        return `0x${i}${rest}`
    }

    const testLarge = n => Array.from(Array(n)).map((undef, i) => new MonoplasmaMember(`Acco${i}`, buildValidAddress(i), i))

    it("is constructed correctly for 3 items", async () => {
        const tree = new MerkleTree(testSmall(3), 1234)
        const { hashes } = await tree.getContents()
        const hashList = hashes.map(buf => (typeof buf === "object" ? `0x${buf.toString("hex")}` : buf))
        assert.deepStrictEqual(hashList, [4,  // "branchCount", i.e. the index where leaf hashes start
            "0x88a894579dc1ac11242da55444d92e406ff2686556630c81162a27965157deac",     //     root
            "0xe9d23210548554e271f8ff4a5208cf5233bb56d6e7294c78fcad5ecc42e096bd",   //  left
            "0x814b26e10015a87381c08291f2b16577c101d87fc66157ed237b88f67257c76a",   //            right
            "0xed5a0925a9a579df831e5319f7c04a49a7895ebe7c8236546920783b0bad5a4f", //   A
            "0xd49a469ba14e622f0fa2ff5ec1bed6f967a68cd6886b3bea4a7631fbaaf4bc61", //       B
            "0x814b26e10015a87381c08291f2b16577c101d87fc66157ed237b88f67257c76a", //              C
            "0x0000000000000000000000000000000000000000000000000000000000000000"  //                 (missing)
        ])
        assert.strictEqual(hashList[4], hashLeaf(a, tree.salt).toString("hex"))
        assert.strictEqual(hashList[5], hashLeaf(b, tree.salt).toString("hex"))
        assert.strictEqual(hashList[6], hashLeaf(c, tree.salt).toString("hex"))
        assert.strictEqual(hashList[3], hashList[6].toString("hex"))
        assert.strictEqual(hashList[2], hashCombined(hashList[4], hashList[5]).toString("hex"))
        assert.strictEqual(hashList[1], hashCombined(hashList[2], hashList[3]).toString("hex"))
    })

    it("is constructed correctly for 5 items", async () => {
        const tree = new MerkleTree(testSmall(5), 3456)
        const { hashes } = await tree.getContents()
        const hashList = hashes.map(buf => (typeof buf === "object" ? `0x${buf.toString("hex")}` : buf))
        assert.deepStrictEqual(hashList, [8,  // "branchCount", i.e. the index where leaf hashes start
            "0x1b6cd614f4f2c86ccc82cd3c8df23c794790e22cf8e56f3255611950a681efe3",             //       root
            "0xa4eb1454b3e945355a5a23d1562f21c54367f9a315ff2793c530b5c1f9bec559",         //     left
            "0xf2156cb0dea8913ac515f0c3ad231414ece7dfb23973bb89dbc4ee0049b9e172",         //                right
            "0x99638428d261a3da604f873c9e2f6779a84aa0b2e001c164c59a3e4377495b80",     //    left
            "0xdb5f253a21520c6be38fda228dc0938e6ac3b6ed61606f4ecccacf4f666c5881",     //         right
            "0xf2156cb0dea8913ac515f0c3ad231414ece7dfb23973bb89dbc4ee0049b9e172",     //                  left
            "0x0000000000000000000000000000000000000000000000000000000000000000", //                       (missing)
            "0xcbd929789577d192c9747193f8ff6be257df5bacb18953d263402b12dde6fbfb", //  A
            "0xdd49055da64dc81c5c9da9be3792f57c6bb4d9adab124556ad5f06e5837c71c4", //    B
            "0xb59af9905674879b38932c92d91ee3c978b2b94dc2e097934990edc71f685cfb", //          C
            "0x64b989e4735794ace37acb89c36db9a97ecb6d2c324c24c1a4e7baa3df307f9c", //             D
            "0xf2156cb0dea8913ac515f0c3ad231414ece7dfb23973bb89dbc4ee0049b9e172", //                  E
            "0x0000000000000000000000000000000000000000000000000000000000000000", //                   (missing)
        ])

        assert.strictEqual(hashList[8], hashLeaf(a, tree.salt).toString("hex"))
        assert.strictEqual(hashList[9], hashLeaf(b, tree.salt).toString("hex"))
        assert.strictEqual(hashList[10], hashLeaf(c, tree.salt).toString("hex"))
        assert.strictEqual(hashList[11], hashLeaf(d, tree.salt).toString("hex"))
        assert.strictEqual(hashList[12], hashLeaf(e, tree.salt).toString("hex"))
        assert.strictEqual(hashList[1], hashCombined(hashList[2],  hashList[3]).toString("hex"))
        assert.strictEqual(hashList[2], hashCombined(hashList[4],  hashList[5]).toString("hex"))
        assert.strictEqual(hashList[3], hashList[6])    // odd needs no hashing
        assert.strictEqual(hashList[4], hashCombined(hashList[8],  hashList[9]).toString("hex"))
        assert.strictEqual(hashList[5], hashCombined(hashList[10], hashList[11]).toString("hex"))
        assert.strictEqual(hashList[6], hashList[12])    // odd needs no hashing
    })

    it("is constructed correctly for 1 item", async () => {
        const tree = new MerkleTree(testSmall(1), 5678)
        const { hashes } = await tree.getContents()
        const hashList = hashes.map(buf => (typeof buf === "object" ? `0x${buf.toString("hex")}` : buf))
        assert.deepStrictEqual(hashList, [2,
            "0x0152b424402445bb5c05369975e54ce015caf6142f50f740a8a740182e93da87",
            "0x0152b424402445bb5c05369975e54ce015caf6142f50f740a8a740182e93da87",
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        ])
    })

    it("fails for 0 items", async () => {
        const tree = new MerkleTree(testSmall(0), 123)
        await assert.rejects(() => tree.getContents())
    })

    it("gives a correct path for 5 items", async () => {
        const members = testSmall(5)
        const tree = new MerkleTree(members, 4321)
        const paths = await Promise.all(members.map(m => tree.getPath(m.address)))
        const root = await tree.getRootHash()
        assert.deepStrictEqual(paths, [
            [
                "0x5c4c79458b136b3102e8785f038c2757aad7a26bfd5300c59e3190c06615bb68",
                "0x2ce424905e0e1614b3639a6814651c36acc28fd7a6be33d8d5fbb6dfdf4c6a01",
                "0x0882200b8014f3ce8cbc72e87b4cdceca89cfb75bff2e34a846cca948738ae04"
            ],
            [
                "0x4ddc37d69d26076eb5241c5c6d82a5a09c7dbae04e7ecba86b1c3e04c344e2a5",
                "0x2ce424905e0e1614b3639a6814651c36acc28fd7a6be33d8d5fbb6dfdf4c6a01",
                "0x0882200b8014f3ce8cbc72e87b4cdceca89cfb75bff2e34a846cca948738ae04"
            ],
            [
                "0x9d03445f44cac137e08067550568f4e415e0c51c81d3586274547208043aa593",
                "0xaa76ab2f486b35fd6d49b79557ad85c4ad60d520665250749efd463a04cfaa3b",
                "0x0882200b8014f3ce8cbc72e87b4cdceca89cfb75bff2e34a846cca948738ae04"
            ],
            [
                "0x8e67188dc47dc839031732d207f245405a790baf1b276f69af172ccb043d0b29",
                "0xaa76ab2f486b35fd6d49b79557ad85c4ad60d520665250749efd463a04cfaa3b",
                "0x0882200b8014f3ce8cbc72e87b4cdceca89cfb75bff2e34a846cca948738ae04"
            ],
            [
                "0xfe71407574dbdb95f250e638be7e9a7ac4a6c53df57b2a7ea54aee4f293510b4"
            ]
        ])

        const memberHash = hashLeaf(e, tree.salt)
        const hashed = calculateRootHash(memberHash, paths[4])
        assert.strictEqual(root, hashed)
    })

    it("gives a correct path for 100 items", async () => {
        const members = testLarge(100)
        const tree = new MerkleTree(members, 2020)
        const path = await tree.getPath(members[50].address)
        const root = await tree.getRootHash()
        assert.deepStrictEqual(path, [
            "0xb8c4babc1431a10d6935da7d76278e433a58b9c70304bcb365e7de7fa3f2e6ff",
            "0xd05327947ae0c1f4b26d437a4f5b8150d9f0b2c6729e718982b40a577da85598",
            "0xaa29de5ffc83e24b1a69bb4aa549958357cbdb973bf2db15f1d9c488864f5302",
            "0x0d7c8aa66aabdc0f1a77d3ca80b443b02d250ae955b2e78afde4925a1c1ba7b2",
            "0x44181ef37ba7f9aab650c50cfa7b571465cdbb58e67c0e45fc7e277ac049190d",
            "0xbfb3e4c6f0a7dcef1514359ec11b66e6097090a027c3be07554489b8022802bd",
            "0x583e976f703c0c398f95f8eed803c6dece9153a76d4d22a18f2c3fc8669cc973"
        ])

        const memberHash = hashLeaf(members[50], tree.salt)
        const hashed = calculateRootHash(memberHash, path)
        assert.strictEqual(root, hashed)
    })

    describe("includes", () => {
        it("is true when member is in tree", () => {
            const members = testLarge(100)
            const tree = new MerkleTree(members, 6453)
            members.forEach(m => {
                assert(tree.includes(m.address), `Member ${m.address} should be found`)
            })
        })

        it("is false when member is not in tree", () => {
            const members = testSmall(10)
            const tree = new MerkleTree(members, 6453)
            members.forEach(m => {
                assert(!tree.includes(m.address + "a"), `Member ${m.address + "a"} should be found`)
            })
        })
    })

    describe("performance", function () {
        this.timeout(10000)
        it("does not block while calculating large tree", async () => {
            const members = testLarge(10000)

            // ticks in a loop
            // returns a function that cancels next tick and returns count
            function tick(n = 0) {
                let end
                const t = setTimeout(() => {
                    end = tick(n + 1)
                })

                return () => {
                    clearTimeout(t)
                    if (end) {
                        return end()
                    }
                    return n
                }
            }

            for (const m of members.slice(0, 1)) {
                const stopTick = tick()
                const tree = new MerkleTree(members, 125)
                await tree.getPath(m.address).then(() => {
                    const count = stopTick()
                    const expectedCount = 50 // roughly?
                    assert(count > expectedCount, `Should have ticked more while getting path. Expected: ${expectedCount},  Actual: ${count}`)
                })
            }
        })

        it("takes a similar duration to getPath for 1 member as it does for n members simultaneously", async () => {
            // checks we don't try start new processes while initial task is in progress
            const members = testLarge(10000)
            // measure duration of getPath for a single member
            const start1 = Date.now()
            await new MerkleTree(members, 123).getPath(members[0].address)
            const singleDuration = Date.now() - start1

            const start2 = Date.now()
            const tree2 = new MerkleTree(members, 123) // new tree so not cached
            // getPath for n members simultaneously on uncached tree
            await Promise.all(members.slice(0, 10).map((m) => (
                tree2.getPath(m.address)
            )))
            const simultaneousDuration = Date.now() - start2
            // duration for n should be less than time to get 2 paths
            assert(simultaneousDuration < (singleDuration * 2))
        })
    })
})
