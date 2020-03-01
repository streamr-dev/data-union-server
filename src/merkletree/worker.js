const debug = require("debug")
const {
    isMainThread,
    parentPort,
    workerData,
} = require("worker_threads")

const MerkleTree = require("./api")

const BUILD_TREE = "BUILD_TREE"
const SUCCESS = "SUCCESS"
const ERROR = "ERROR"

const exit = () => {
    parentPort.removeListener("message", onMessage)
    //process.exitCode = 0
}

const Log = debug(`Streamr::CPS::merkletree::worker::${process.pid}`)

const isChild = !isMainThread

if (isChild) {
    Log("started")
    parentPort.once("message", onMessage)
    if (workerData) {
        onMessage(workerData)
    }

    parentPort.once("close", () => Log("done"))
}


function serialiseTree(tree) {
    return Object.assign({}, tree, {
        hashes: [
            tree.hashes[0],
            ...tree.hashes.slice(1).map((h) => h.toString("hex"))
        ]
    })
}

function deserialiseTree(tree) {
    return Object.assign({}, tree, {
        hashes: [
            tree.hashes[0],
            ...tree.hashes.slice(1).map((h) => (
                h && Buffer.from(h, "hex")
            ))
        ]
    })
}

let nextMessageId = 0
function onMessage({ type, payload }) {
    const messageId = nextMessageId++
    let log = Log.extend(messageId)

    function onError(error) {
        log("error", error)
        parentPort.postMessage({
            type: ERROR,
            payload: Object.assign({}, error, {
                type: error.constructor.name,
                message: error.message,
                stack: error.stack,
                code: error.code,
            }),
        }, exit)
    }

    if (type !== BUILD_TREE) {
        onError(new Error(`Unknown action type: ${type}`))
        return
    }

    log = log.extend(type)

    log("started")

    buildTree(payload).then((tree) => {
        parentPort.postMessage({
            type: SUCCESS,
            payload: serialiseTree(tree),
        }, exit)
    }, onError).finally(() => {
        log("done")
    })
}

async function buildTree(contents) {
    const tree = new MerkleTree(contents)
    return tree.getContents()
}

module.exports = {
    onMessage,
    BUILD_TREE,
    ERROR,
    SUCCESS,
    serialiseTree,
    deserialiseTree,
}
