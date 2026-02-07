import {existsSync} from "node:fs"
import {dirname, join} from "node:path"

let baseDir = process.cwd()
/** @type {string|null} */
let packageRoot = null
while (baseDir !== dirname(baseDir)) {
    if (existsSync(join(baseDir, "package.json"))) {
        packageRoot = baseDir
        break
    }
    baseDir = dirname(baseDir)
}
if (!packageRoot) {
    const rootCandidate = join(baseDir, "package.json")
    if (existsSync(rootCandidate)) {
        packageRoot = rootCandidate
    }
}
if (!packageRoot) {
    process.exit(1)
}

export default {
    "lock": {
        "bun": join(packageRoot, "bun.lock"),
        "npm": join(packageRoot, "package-lock.json"),
        "pnpm": join(packageRoot, "pnpm-lock.yaml")
    },
    "node_modules": join(packageRoot, "node_modules"),
    "package": join(packageRoot, "package.json")
}
