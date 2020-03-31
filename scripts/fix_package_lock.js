/*
 * Fixes package-lock.json to update scrypt.js to 0.3.0
 * so it's installable on Node 12
 */

const { join } = require("path")
const fs = require("fs")

const lockfilePath = join(process.cwd(), "package-lock.json")

try {
    fs.accessSync(lockfilePath, fs.constants.R_OK | fs.constants.W_OK)
} catch (err) {
    console.warn("No package-lock.json, or not readable/writable. Skipping.")
    process.exit(1)
    return
}

const lockfile = require(lockfilePath)

let changed = false
function fixPackage(obj) {
    const updated = Object.assign({}, obj)
    Object.entries(typeof updated.requires === "object" ? updated.requires : {}).forEach(([key, value]) => {
        if (key === "scrypt.js" && value !== "0.3.0") {
            changed = true
            updated.requires[key] = "0.3.0"
        }

        if (key === "scrypt") {
            changed = true
            delete updated.requires[key]
        }
    })

    Object.entries(typeof updated.dependencies === "object" ? updated.dependencies : {}).forEach(([key, value]) => {
        if (key === "scrypt.js" && value.version !== "0.3.0") {
            changed = true
            updated.dependencies[key] = Object.assign({}, value, {
                version: "0.3.0",
                resolved: "https://registry.npmjs.org/scrypt.js/-/scrypt.js-0.3.0.tgz",
                integrity: "sha512-42LTc1nyFsyv/o0gcHtDztrn+aqpkaCNt5Qh7ATBZfhEZU7IC/0oT/qbBH+uRNoAPvs2fwiOId68FDEoSRA8/A==",
            })
        }
        if (key === "scrypt" && !value.optional) {
            changed = true
            updated.dependencies[key] = Object.assign({}, value, {
                optional: true,
            })
        }
        updated.dependencies[key] = fixPackage(updated.dependencies[key])
    })

    return updated
}

const updatedLockfile = fixPackage(lockfile)

if (!changed) {
    console.warn("No changes to package-lock.json changes required.")
    process.exit(1)
    return
}

fs.writeFileSync(lockfilePath, JSON.stringify(updatedLockfile, null, 2))

console.warn("Changed package-lock.json. Run `npm ci`.")
