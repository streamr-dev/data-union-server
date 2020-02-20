const { fork } = require("child_process")

const {
    BUILD_TREE,
    SUCCESS,
    ERROR,
    deserialiseTree,
} = require("./worker")

const MerkleTree = require("./api")

function wrapErrorObject(message, err) {
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
            payload: treeContents.map((m) => m.toObject()),
        })
        if (result.type === SUCCESS) {
            return deserialiseTree(result.payload)
        }
        if (result.type === ERROR) {
            throw wrapErrorObject(result.payload)
        }
    }
}

module.exports = class MerkleTreeRPCWrapper extends MerkleTree {
    constructor(...args) {
        super(...args)
        this.worker = new Worker()
    }

    async getContents() {
        if (this.contents.length === 0) {
            throw new Error("Can't construct a MerkleTree with empty contents!")
        }
        if (this.isDirty) {
            const { contents } = this
            // TODO: sort, to enforce determinism?
            const cached = await this.worker.buildTree(contents)
            //const cached = await new MerkleTree(contents).getContents()
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
