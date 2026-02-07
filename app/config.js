import {existsSync} from "node:fs"
import {join} from "node:path"
import paths from "./paths.js"

/**
 * @typedef {"all"|"latest"|"nonlatest"|"semi"|"changed"|"blocked"|"none"}
 * AskLevel
 */

const config = {
    /** @type {AskLevel} */
    "ask": "none",
    "dedupe": true,
    "deps": {
        "dev": true,
        "optional": false,
        "peer": false,
        "prod": true
    },
    /** @type {"all"|"deps"|"prod"|"none"} */
    "install": "all",
    "minAge": 0,
    /** @type {{[name: string]: string}} */
    "overrides": {},
    /** @type {"auto"|"npm"|"npx pnpm"|"pnpm"|"npx bun"|"bun"} */
    "tool": "auto"
}
const askLevels = ["all", "latest", "nonlatest", "semi", "changed", "blocked"]

/**
 * Check if a string is a valid ask level or not.
 * @param {string} level
 * @returns {level is AskLevel}
 */
const isValidAskLevel = level => askLevels.includes(level)

const nusConfigFile = join(process.cwd(), "nus.config.js")
if (existsSync(nusConfigFile)) {
    let customConfig = null
    try {
        customConfig = await import(nusConfigFile)
        customConfig = customConfig.default ?? customConfig
    } catch {
        console.warn("X Ignoring 'nus.config.js' file, invalid JS")
    }
    if (customConfig) {
        if (customConfig.tool !== undefined) {
            const tools = ["auto", "npm", "npx pnpm", "pnpm", "npx bun", "bun"]
            if (tools.includes(customConfig.tool)) {
                config.tool = customConfig.tool
            } else {
                console.warn(`X Ignoring 'tool', must be: ${
                    tools.map(p => `'${p}'`).join(", ")}`)
            }
        }
        for (const depType of Object.keys(config.deps)) {
            if (typeof customConfig.deps?.[depType] === "boolean") {
                config.deps[depType] = customConfig.deps[depType]
            } else if (customConfig.deps?.[depType] !== undefined) {
                console.warn(`X Ignoring 'deps.${depType}', must be boolean`)
            }
        }
        if (customConfig.minAge !== undefined) {
            if (typeof customConfig.minAge === "number") {
                config.minAge = Math.max(customConfig.minAge, 0)
            } else {
                console.warn("X Ignoring 'minAge', must be number")
            }
        }
        const installTypes = ["all", "deps", "prod", "none"]
        if (installTypes.includes(customConfig.install)) {
            config.install = customConfig.install
        } else if (customConfig.install !== undefined) {
            console.warn(`X Ignoring 'install', must be one of: ${
                installTypes.join(", ")}`)
        }
        if (typeof customConfig.dedupe === "boolean") {
            config.dedupe = customConfig.dedupe
        } else if (customConfig.dedupe !== undefined) {
            console.warn("X Ignoring 'dedupe', must be boolean")
        }
        if (isValidAskLevel(customConfig.ask)) {
            config.ask = customConfig.ask
        } else if (customConfig.ask !== undefined) {
            console.warn(`X Ignoring 'ask', must be one of: ${
                askLevels.join(", ")}`)
        }
        if (typeof customConfig.overrides === "object") {
            for (const [key, value] of Object.entries(customConfig.overrides)) {
                if (typeof value !== "string") {
                    console.warn(`X Ignoring override '${
                        key}', value must be string`)
                    continue
                }
                config.overrides[key] = value
            }
        } else if (customConfig.overrides !== undefined) {
            console.warn("X Ignoring 'overrides', "
                + "must be a flat string-string object")
        }
    }
}

/**
 * Check if a command is in the path by trying to find it in the PATH env var.
 * @param {string} command
 */
const isInPath = command => {
    for (const folder of process.env.PATH?.split(":") ?? []) {
        if (existsSync(join(folder, command))) {
            return true
        }
    }
    return false
}

/** Set the tool config based on lock files, via npx if not found in path. */
const autoDetectTool = () => {
    if (existsSync(paths.lock.npm)) {
        config.tool = "npm"
    } else if (existsSync(paths.lock.pnpm)) {
        if (isInPath("pnpm")) {
            config.tool = "pnpm"
        } else {
            config.tool = "npx pnpm"
        }
    } else if (existsSync(paths.lock.bun)) {
        if (isInPath("bun")) {
            config.tool = "bun"
        } else {
            config.tool = "npx bun"
        }
    } else {
        config.tool = "npm"
    }
}

if (config.tool === "auto") {
    autoDetectTool()
}

/**
 * Print command line interface usage and exit with code.
 * @param {number} code
 */
const printUsage = (code = 1) => {
    console.info(`
nus: Node update script - A script to update all node packages in a project

Usage: nus [options]

Options:
 --help      Print this help and exit.

 --ask       Start in interactive ask mode of type "all"
             A version selector will be shown for each and every package.

 --ask=<val> Start in interactive ask mode of type <val>, where <val> can be:
             ${askLevels.join(", ")}
             A version selector will be shown for each to be updated package,
             which matches the type of <val> selected for updating.
             Only "all" will show the selector for latest up to date packages.
             Most values select between the three main states of updating:
             - blocked: can't be updated at all due to overrides or minAge
             - semi: Package can be updated but not to latest because of that
             - latest: Package will be updated to latest but were not before
             You can choose to mix these into broader selectors via these:
             - nonlatest: blocked + semi
             - changed: semi + latest

nus is created by Jelmer van Arnhem and contributors.
Website: https://github.com/Jelmerro/nus License: MIT
This is free software; you are free to change and redistribute it.
There is NO WARRANTY, to the extent permitted by law.
See the LICENSE file or the website for details.`.trim())
    process.exit(code)
}

for (const a of process.argv.slice(2)) {
    const arg = a.trim()
    if (arg === "--help") {
        printUsage(0)
    } else if (arg === "--ask") {
        config.ask = "all"
    } else if (arg.startsWith("--ask=")) {
        const argVal = arg.split("=").slice(1).join("=")
        if (isValidAskLevel(argVal)) {
            config.ask = argVal
        }
    } else {
        printUsage()
    }
}

export default config
