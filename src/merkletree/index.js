const { fork } = require("child_process")

const {
    BUILD_TREE,
    SUCCESS,
    ERROR,
    deserialiseTree,
} = require("./worker")

const MerkleTree = require("./api")

function wrapErrorObject(err, message) {
    let newError
    if (err instanceof Error) {
        newError = Object.create(err)
    } else {
        newError = new Error()
    }
    if (err.stack) {
        // copy stack
        newError.stack = err.stack
    }
    // prefix with new message
    newError.message = [message, err.message].filter(Boolean).join("\n")
    return newError
}

/**
 * Encode a Redux-like action for RPC calls
 * @typedef {Object} Action
 * @property {String} type Action name
 * @property {Object} payload Arbitrary value as payload
 */

/**
 * Implements RPC between parent and worker process.
 */
class RPCWorker {
    constructor() {
        /** @property {ChildProcess} proc Worker child process */
        this.proc = undefined
    }

    /**
     * Creates new process if needed.
     * @returns {ChildProcess}
     */
    initIfNeeded() {
        if (this.proc && this.proc.connected) {
            return this.proc
        }
        this.proc = fork(require.resolve("./worker"))
        this.proc.once("exit", () => {
            this.proc = undefined
        })
        return this.proc
    }

    /**
     * Sends `message` to worker process.
     * Creates new process if needed.
     * @param {Object|String} message
     */
    async send(message) {
        return new Promise((resolve, reject) => {
            let result
            const proc = this.initIfNeeded()
                .once("exit", (code) => {
                    if (result) {
                        resolve(result)
                        return
                    }

                    reject(new Error(`Worker exited with code: ${code}`))
                })
                .once("error", reject)
                .once("message", (message) => {
                    result = message
                })

            proc.send(message)
        })
    }

    /**
     * Sends Action to worker process, returns response.
     * Handles converting rejections into Actions
     * @param {Action} action
     * @return {Promise<Action>} Response
     */
    async sendAction({ type, payload }) {
        return this.send({ type, payload })
            .catch((error) => ({
                type: ERROR,
                payload: error,
            }))
    }

    /**
     * Workflow for sending tree to worker
     * Serialize tree -> send -> deserialize response.
     * @param {Array<MonoplasmaMember>} treeContents
     * @return {Promise<MerkleTree>} tree data
     */
    async buildTree(treeContents) {
        const result = await this.sendAction({
            type: BUILD_TREE,
            payload: treeContents.map((m) => (
                // convert Member instances to member Objects
                // support both as when members are read from disk
                // block.members are just JSON, no point converting
                // to instances just to convert them back to Objects
                m.toObject ? m.toObject() : m
            )),
        })
        if (result.type === SUCCESS) {
            return deserialiseTree(result.payload)
        }
        if (result.type === ERROR) {
            throw wrapErrorObject(result.payload)
        }
    }
}

/**
 * Ensures multiple calls to `fn` with the same *first argument*
 * will only execute `fn` once while `fn` resolves.
 * @param {AsyncFunction} fn Async function that does work
 */

function limitDuplicateAsyncWork(fn) {
    // note only supports objects as keys, Map may be sufficient
    const taskCache = new WeakMap()
    // first parameter treated as key
    return async (key, ...args) => {
        if (taskCache.has(key)) {
            // use cached value
            return taskCache.get(key)
        }

        // wrap with Promise.resolve().then to any sync errors are accounted for
        const currentTask = Promise.resolve().then(() => fn(key, ...args)).finally(() => {
            // clean from cache after running
            taskCache.delete(key)
        })

        taskCache.set(key, currentTask)
        return currentTask
    }
}

/**
 * Reimplements MerkleTree getContents as call to async worker
 */

module.exports = class MerkleTreeWorkerWrapper extends MerkleTree {
    constructor(...args) {
        super(...args)
        this.buildTree = limitDuplicateAsyncWork(this.buildTree)
    }

    async buildTree(contents) {
        // this method should be wrapped with limitDuplicateAsyncWork
        // to prevent recalculating duplicate trees

        // just calculate small trees in-process
        if (contents.length < 100) {
            return new MerkleTree(contents).getContents()
        }

        // farm out larger tree calculations to worker process
        return new RPCWorker().buildTree(contents)
    }

    async getContents() {
        if (this.contents.length === 0) {
            throw new Error("Can't construct a MerkleTree with empty contents!")
        }

        if (this.isDirty) {
            const { contents } = this


            // TODO: sort, to enforce determinism?
            const cached = await this.buildTree(contents)

            // check for subsequent updates during build
            // only update state if no change
            if (this.contents === contents) {
                this.cached = cached
                this.isDirty = false
            }
            return cached
        }
        return this.cached
    }
}
