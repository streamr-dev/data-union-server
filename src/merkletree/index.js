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

class Worker {
    async send(message) {
        return new Promise((resolve, reject) => {
            let result
            if (this.proc) {
                this.proc.kill()
            }
            this.proc = fork(require.resolve("./worker"))
            this.proc.once("exit", (code) => {
                if (result) {
                    resolve(result)
                    return
                }

                reject(new Error(`Worker exited with code: ${code}`))
            })
            this.proc.once("error", reject)
            this.proc.once("message", (message) => {
                result = message
            })
            this.proc.send(message)
        })
    }

    async sendAction({ type, payload }) {
        return this.send({ type, payload })
            .catch((error) => ({
                type: ERROR,
                payload: error,
            }))
    }

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
 * Ensures multiple calls to `fn` with the same first argument
 * will only execute `fn` once while `fn` resolves.
 */

function limitDuplicateAsyncWork(fn) {
    const taskCache = new WeakMap()
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

module.exports = class MerkleTreeRPCWrapper extends MerkleTree {
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
