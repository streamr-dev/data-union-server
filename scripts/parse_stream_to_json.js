#!/usr/bin/env node

// input: stream messages
// first line: [31,["szZk2t2JTZylrRwN6CYJNg",0,1586599251024,0,"0xf3e5a65851c3779f468c9ecb32e6f25d9d68601a","1Oz6wgRD5Ee6QxFxY7za"],null,27,0,"{\\"addresses\\":[\\"0x9Cc255F25F8523AB25D4e455ECCBDB9ADF7B0FD0\\"],\\"type\\":\\"join\\"}",2,"0x68cd6545ab06e089d3e67cc0e2d76bcdccde16a01aa3e18c65741ee4bc8f7b0911b0b64bea4273fb42b931006335088eaf34a0c54d11e9ea1d5c32668e6f01551c"]
// subsequent: [31,["szZk2t2JTZylrRwN6CYJNg",0,1586599258634,0,"0xf3e5a65851c3779f468c9ecb32e6f25d9d68601a","1Oz6wgRD5Ee6QxFxY7za"],[1586599251024,0],27,0,"{\\"addresses\\":[\\"0x7aE9EB6F6b898DcBA807FE10a34FFC2EaA070a20\\"],\\"type\\":\\"join\\"}",2,"0x61bf4709b9811c53e37b20fd616e1a8c85bfd5b38d5000a32dc62b3e6af3b74003999cedb19892e6d2dcd1ff4aa2a57b39534fd675c05818cf15e2dfb90361be1c"]
//                                             ^^^^^^^^^^^^^                                                                                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                               timestamp                                                                                                    payload = rest of the message
// version 32: [32,["szZk2t2JTZylrRwN6CYJNg",0,1609293613451,0,"0x8d4597fB06aDc1AaA2285777B0b2A7f279Cfc266","SglTq9k0buDhp2CaDkiz"],[1609292336720,0],27,0,0,null,"{\\"type\\":\\"join\\",\\"addresses\\":[\\"0xb63eC3aB59Ce7c7dEb647f86DAceFd3D2018A4a8\\"]}",null,2,"0x5d153fe3a3aa2269674d3105c76b4b5805e19c81038ada8018c1dd2f30e5d22d6413b532b87b2e8b9759e944939548b6ec3e2ce85ba53435e2f2262367830a6e1b"]
//                                             ^^^^^^^^^^^^^                                                                                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                               timestamp                                                                                                            payload = rest of the message

// output: StreamrChannel events
// [
//     {
//       "addresses": [
//         "0x9Cc255F25F8523AB25D4e455ECCBDB9ADF7B0FD0"
//       ],
//       "type": "join",
//       "timestamp": 1586599251024
//     },
//    ...
// ]

const fs = require("fs")

const [,, infile, outfile] = process.argv

if (!infile) {
    console.log("Usage: ./parse_stream_to_json.js <infile> [<outfile>]")
    console.log("  Print to stdout if outfile omitted")
    console.log()
    process.exit(1)
}
if (!fs.existsSync(infile)) {
    console.log("Input file", infile, "not found!")
    process.exit(1)
}

const lines = fs.readFileSync(infile).toString().split("\n")
const events = lines.map(line => {
    try {
        const msg = JSON.parse(line.replace(/\\\\/g, "\\"))
        const version = msg[0]
        if (version !== 31 && version !== 32) {
            throw new Error("Unsupported version", version, ". Expected 31...32.")
        }
        const timestamp = msg[1][2]
        const payload =
            version === 31 ? JSON.parse(msg[5]) :
            version === 32 ? JSON.parse(msg[7]) : null
        return {
            ...payload,
            timestamp,
        }
    } catch(e) {
        console.log("Bad message", line)
        throw new Error(e)
    }
})

if (!outfile) {
    console.log(JSON.stringify(events))
} else {
    fs.writeFileSync(outfile, JSON.stringify(events))
}
