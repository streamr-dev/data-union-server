const assert = require("assert")
const MonoplasmaMember = require("../../src/member")
const MerkleTree = require("../../src/merkletree")
const { hash, hashCombined, hashLeaf } = MerkleTree
const sleep = require("../../src/utils/sleep-promise")

// calculate the root hash using the path (sync with SidechainCommunity.sol:rootHash)
function calculateRootHash(hash, path) {
    for (let i = 0; i < path.length; i += 1) {
        if (Number(path[i]) === 0) { continue }                    // eslint-disable-line no-continue
        const other = Buffer.from(path[i].slice(2), "hex")
        if (hash.compare(other) === -1) {
            hash = hashCombined(hash, other)
        } else {
            hash = hashCombined(other, hash)
        }
    }
    return hash
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
        const tree = new MerkleTree(testSmall(3))
        const t = await tree.getContents()
        const { hashes } = t
        const hashList = hashes.map(buf => (typeof buf === "object" ? buf.toString("hex") : buf))
        assert.deepStrictEqual(hashList, [4,  // "branchCount", i.e. the index where leaf hashes start
            "dd9789560ea2c9f1bd696fb348d239063d2bf078902b4c6b5e2ccfc2b45cde21",     //     root
            "2c0851c9ca186c6a34e6b83f056f9cb9121430bf6f04c951a7ba655b513f6059",   //  left
            "00c99bd92a2211cbeaab19380a2aa0b9a36980228b5695c69f8265f9055444e1",   //            right
            "80cbbaa563d509ffd388bd6e716bd85c0c35da5c87bbfb457c9c8cff0d518419", //   A
            "3f37e976185114769bdf46f66cdd0ec8e51a4a81cd378679513fd4ab5645450c", //       B
            "00c99bd92a2211cbeaab19380a2aa0b9a36980228b5695c69f8265f9055444e1", //              C
            "0000000000000000000000000000000000000000000000000000000000000000", //                 (missing)
        ])
        assert.strictEqual(hashList[4], hash(a.toHashableString()).toString("hex"))
        assert.strictEqual(hashList[5], hash(b.toHashableString()).toString("hex"))
        assert.strictEqual(hashList[6], hash(c.toHashableString()).toString("hex"))
        assert.strictEqual(hashList[3], hashList[6].toString("hex"))
        assert.strictEqual(hashList[2], hashCombined(hashList[5], hashList[4]).toString("hex"))
        assert.strictEqual(hashList[1], hashCombined(hashList[3], hashList[2]).toString("hex"))
    })

    it("is constructed correctly for 5 items", async () => {
        const tree = new MerkleTree(testSmall(5))
        const { hashes } = await tree.getContents()
        const hashList = hashes.map(buf => (typeof buf === "object" ? buf.toString("hex") : buf))
        assert.deepStrictEqual(hashList, [8,  // "branchCount", i.e. the index where leaf hashes start
            "68d7d43f9603a819e00ad7a8003eba2a0d96a9c5bd89841c42d62e0bead09b5d",             //       root
            "39720c89aa9c0c443c3c9e9e283a8bf1064c15bb8cd066c78a98fa31573aa95a",         //     left
            "82dd6ef28bf5a82738985884f1d599fc2e15109ab21d3c361c88397c5e36e59f",         //                right
            "2c0851c9ca186c6a34e6b83f056f9cb9121430bf6f04c951a7ba655b513f6059",     //    left
            "006a9f9553ae503d31a22eb2589ac9eafe3740b29c9451210313031fcea49efa",     //         right
            "82dd6ef28bf5a82738985884f1d599fc2e15109ab21d3c361c88397c5e36e59f",     //                  left
            "0000000000000000000000000000000000000000000000000000000000000000", //                       (missing)
            "80cbbaa563d509ffd388bd6e716bd85c0c35da5c87bbfb457c9c8cff0d518419", //  A
            "3f37e976185114769bdf46f66cdd0ec8e51a4a81cd378679513fd4ab5645450c", //    B
            "00c99bd92a2211cbeaab19380a2aa0b9a36980228b5695c69f8265f9055444e1", //          C
            "cf3c370bef592b8da4ad2d1d7ff5085d70be954f2d9f6167d97726ad6b940b1f", //             D
            "82dd6ef28bf5a82738985884f1d599fc2e15109ab21d3c361c88397c5e36e59f", //                  E
            "0000000000000000000000000000000000000000000000000000000000000000", //                   (missing)
        ])

        assert.strictEqual(hashList[8], hash(a.toHashableString()).toString("hex"))
        assert.strictEqual(hashList[9], hash(b.toHashableString()).toString("hex"))
        assert.strictEqual(hashList[10], hash(c.toHashableString()).toString("hex"))
        assert.strictEqual(hashList[11], hash(d.toHashableString()).toString("hex"))
        assert.strictEqual(hashList[12], hash(e.toHashableString()).toString("hex"))
        assert.strictEqual(hashList[1], hashCombined(hashList[2],  hashList[3]).toString("hex"))
        assert.strictEqual(hashList[2], hashCombined(hashList[5],  hashList[4]).toString("hex"))
        assert.strictEqual(hashList[3], hashList[6])    // odd needs no hashing
        assert.strictEqual(hashList[4], hashCombined(hashList[9],  hashList[8]).toString("hex"))
        assert.strictEqual(hashList[5], hashCombined(hashList[10], hashList[11]).toString("hex"))
        assert.strictEqual(hashList[6], hashList[12])    // odd needs no hashing
    })

    it("is constructed correctly for 1 item", async () => {
        const tree = new MerkleTree(testSmall(1))
        const { hashes } = await tree.getContents()
        const hashList = hashes.map(buf => (typeof buf === "object" ? buf.toString("hex") : buf))
        assert.deepStrictEqual(hashList, [2,
            "80cbbaa563d509ffd388bd6e716bd85c0c35da5c87bbfb457c9c8cff0d518419",
            "80cbbaa563d509ffd388bd6e716bd85c0c35da5c87bbfb457c9c8cff0d518419",
            "0000000000000000000000000000000000000000000000000000000000000000",
        ])
    })

    it("fails for 0 items", async () => {
        await assert.rejects(async () => {
            const tree = new MerkleTree(testSmall(0))
            await tree.getContents()
        })
    })
    describe("getPath", () => {
        it("gives a correct path for 5 items", async () => {
            const members = testSmall(5)
            const tree = new MerkleTree(members)
            const path = await tree.getPath("0x5f428050ea2448ed2e4409be47e1a50ebac0b2d2")
            const root = await tree.getRootHash()
            assert.deepStrictEqual(path, [
                "0x0000000000000000000000000000000000000000000000000000000000000000",
                "0x0000000000000000000000000000000000000000000000000000000000000000",
                "0x39720c89aa9c0c443c3c9e9e283a8bf1064c15bb8cd066c78a98fa31573aa95a",
            ])

            const memberHash = hashLeaf(e, "")
            const hashed = calculateRootHash(memberHash, path)
            assert.strictEqual(root, `0x${hashed.toString("hex")}`)
        })

        it("gives a correct path for 100 items", async () => {
            const members = testLarge(100)
            const tree = new MerkleTree(members)
            const path = await tree.getPath("0x50428050ea2448ed2e4409be47e1a50ebac0b2d2")
            const root = await tree.getRootHash()
            assert.deepStrictEqual(path, [
                "0x3899f1e3196adaca54e5fce47c83478bbc68d82e1c4db340ff4d5be077da5809",
                "0xc27f2d90363c8681b7703d71466b0d29bc971e176548d925e9252568f9b93a4a",
                "0x22a472070f84cb2259fc2dcdf5b7b387390e0fc01fd949dd113f4b2426af24d7",
                "0xc09fb967d65193de64670085a09a814f51be24c9461b361c960f9fe049be724d",
                "0xc49d351e156eedeff8dc29f1414835e8d243d9d98cb8ab0d62b76e4e159fa7c5",
                "0x368cc389cf2618d7c101a854fff75ed5a547d0986bf78da6153da23b8fea16ee",
                "0xa697780bec0c72e7a647f0cc067dd2b30732cbbb362d63f2eccee67dee345690"
            ])

            const memberHash = hashLeaf(members.find(m => m.address === "0x50428050ea2448ed2e4409be47e1a50ebac0b2d2"), "")
            const hashed = calculateRootHash(memberHash, path)
            assert.strictEqual(root, `0x${hashed.toString("hex")}`)
        })
    })

    describe("includes", () => {
        it("is true when member is in tree", () => {
            const members = testLarge(100)
            const tree = new MerkleTree(members)
            for (let i = 0; i < 100; i++) {
                const a = buildValidAddress(i)
                const m = tree.includes(a)
                assert(m)
            }
        })
        it("is false when member is not in tree", () => {
            const tree = new MerkleTree(testSmall(1))
            for (let i = 0; i < 10; i++) {
                const a = buildValidAddress(i)
                const m = tree.includes(a + "1")
                assert(!m)
            }
        })
    })

    describe("update", () => {
        it("can update tree", async () => {
            const members = testLarge(5)
            const [member1] = members
            const tree = new MerkleTree([member1])
            const member1Path1 = await tree.getPath(member1.address)
            assert.ok(member1Path1, "member should have a path")
            // capture root hash so we can check it changes
            const rootBefore = await tree.getRootHash()
            tree.update(members)

            await Promise.all(members.map(async (m) => {
                assert.ok(await tree.getPath(m.address), "member should have path")
            }))
            const rootAfter = await tree.getRootHash()
            assert.notStrictEqual(rootBefore, rootAfter, "root hash should change after update")
        })

        it("can update tree while tree being calculated", async () => {
            const members = testLarge(1000)
            // add members in two batches
            const firstBatch = members.slice(0, members.length / 2)
            const secondBatch = members.slice(members.length / 2)
            const tree = new MerkleTree(firstBatch)
            // trigger a tree calculation before calling update
            const batch1Task1 = tree.getPath(firstBatch[0].address)
            tree.update(firstBatch.concat(secondBatch))
            // trigger calculations after update
            const batch2Task = tree.getPath(secondBatch[0].address)
            const batch1Task2 = tree.getPath(firstBatch[0].address)
            const [batch1Path1, batch2Path, batch1Path2] = await Promise.all([batch1Task1, batch2Task, batch1Task2])
            // ensure all resolve correctly
            assert.ok(batch1Path1)
            assert.ok(batch2Path)
            assert.ok(batch1Path2)
            // getPath on same member from before update
            // should give different path to getPath from after update
            // i.e. update doesn't affect existing getPath call
            assert.notStrictEqual(batch1Path1, batch1Path2, "path should change")
        })
    })

    describe("performance", function () {
        this.timeout(10000)
        it("does not block while calculating", async () => {
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
                const tree = new MerkleTree(members)
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
            await new MerkleTree(members).getPath(members[0].address)
            const singleDuration = Date.now() - start1

            const start2 = Date.now()
            const tree2 = new MerkleTree(members) // new tree so not cached
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
