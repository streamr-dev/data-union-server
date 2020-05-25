
//blockUtil.js <blockFile> [<address>+] print merkle tree info

const MerkleTree = require("../src/merkletree/api")


async function merkleInfo(filename, addresses) {
    console.log(`merkle tree info from ${filename} for addresses ${addresses}`)
    const blockFile = require(filename)
    console.log(`members ${JSON.stringify(blockFile)}`)
    const salt = blockFile.blockNumber
    const members = blockFile.members
    const merkle = new MerkleTree(members, salt)
    const rootHash = await merkle.getRootHash()
    console.log(`rootHash ${rootHash}\nblockNumber ${blockFile.blockNumber}`)
    addresses.forEach((address) => {
        //console.log(`address ${address}`)
        
        merkle.getPath(address).then((proof) =>
            console.log(`address ${address} proof: ${JSON.stringify(proof)}`)
        )
        
    })
}

var args = process.argv.slice(2)
const blockFileName = args.shift()
merkleInfo(blockFileName, args)
