#!/usr/bin/env node

import {execSync} from "node:child_process"
import {existsSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import maxSatisfying from "semver/ranges/max-satisfying.js"

const config = {
    "audit": true,
    "cli": {
        "force": false,
        "foregroundScripts": true,
        "fundHide": true,
        "global": false,
        "ignoreScripts": false,
        "legacy": false,
        "silent": false,
        "verbose": false
    },
    "dedupe": true,
    /** @type {{[name: string]: string}} */
    "overrides": {},
    "prefixChar": "",
    /** @type {"npm"|"npx pnpm"|"pnpm"|"npx bun"|"bun"} */
    "tool": "npm"
}

/**
 * Find the version of a package by direct version matching or semver range.
 * @param {string[]} versions - The list of versions available.
 * @param {string} range - The version range to search for.
 */
const findByRange = (versions, range) => {
    if (versions.includes(range)) {
        return range
    }
    return maxSatisfying(versions, range)
}

/**
 * Find the type of version selector, such as semver, alias or git package.
 * @param {string} name
 * @param {string} version
 */
const findVersionType = (name, version) => {
    /** @type {"semver"|"alias"|"git"|"url"|"file"} */
    let verType = "semver"
    let alias = null
    if (version.startsWith("npm:")) {
        alias = version.replace(/^npm:/, "")
            .split("@").slice(0, -1).join("@")
        verType = "alias"
    }
    const hasSlashes = name.includes("/") || version.includes("/")
    if (hasSlashes && !name.startsWith("@")) {
        verType = "git"
        if (version.startsWith("http:") || version.startsWith("https:")) {
            verType = "url"
        } else if (version.startsWith("file:")) {
            verType = "file"
        }
    }
    return {alias, verType}
}

/**
 * Find the wanted version for a given package based on desired version string.
 * @param {{
 *   alias?: string|null,
 *   desired: string,
 *   name: string,
 *   paddedName: string,
 *   verType: "alias"|"semver",
 *   version: string,
 * }} opts
 */
const findWantedVersion = ({
    alias, desired, name, paddedName, version, verType
}) => {
    /**
     * @type {{
     *   "dist-tags": {[name: string]: string|null},
     *   "versions": string[]
     * }|null}
     */
    let info = null
    try {
        const pkg = alias ?? name
        /** @type {import("node:child_process").ExecSyncOptions} */
        const cmdOpts = {
            "encoding": "utf8", "stdio": ["ignore", "pipe", "ignore"]
        }
        if (config.tool.endsWith("bun")) {
            const distCmd = `${config.tool} info ${pkg} --json dist-tags`
            const versionCmd = `${config.tool} info ${pkg} --json versions`
            info = {
                "dist-tags": JSON.parse(execSync(distCmd, cmdOpts).toString()),
                "versions": JSON.parse(execSync(versionCmd, cmdOpts).toString())
            }
        } else {
            const cmd = `${config.tool} view ${pkg} --json versions dist-tags`
            info = JSON.parse(execSync(cmd, cmdOpts).toString())
        }
    } catch {
        // Can't update package without this info, next if will be entered.
    }
    if (!info?.["dist-tags"] || !info?.versions) {
        console.info(`X ${paddedName}${version} (${desired})`)
        console.warn(`X Failed, ${config.tool} request for ${
            name} gave invalid info, sticking to ${version}`)
        return null
    }
    let {latest} = info["dist-tags"]
    if (desired === "latest" && config.prefixChar) {
        latest = config.prefixChar + latest
    }
    let wanted = latest
    if (desired !== "latest") {
        wanted = info["dist-tags"][desired]
            ?? findByRange(info.versions, desired)
    }
    if (!wanted || !latest) {
        console.info(`X ${paddedName}${version} (${desired})`)
        console.warn(`X Failed, no ${desired} version for ${
            name}, sticking to ${version}`)
        return null
    }
    if (verType === "alias") {
        wanted = `npm:${alias}@${wanted}`
    }
    let desiredMsg = ""
    if (desired !== "latest") {
        if (desired === latest) {
            desiredMsg = ` (${desired})`
        } else {
            desiredMsg = ` (${desired} ~ ${latest})`
        }
    }
    if (wanted === version) {
        if (desiredMsg && desired !== latest) {
            console.info(`~ ${paddedName}${version}${desiredMsg}`)
        } else {
            console.info(`  ${paddedName}${version}${desiredMsg}`)
        }
    } else {
        console.info(`> ${paddedName}${version} > ${wanted}${desiredMsg}`)
    }
    return wanted
}

const packageJson = join(process.cwd(), "package.json")
/** @type {import('./package.json')|null} */
let pack = null
/** @type {number|"\t"} */
let indent = 2
try {
    const packStr = readFileSync(packageJson, {"encoding": "utf8"}).toString()
    const line = packStr.split("\n").find(
        l => l.startsWith(" ") || l.startsWith("\t")) ?? ""
    indent = line.search(/\S|$/) ?? indent
    if (line.startsWith("\t")) {
        indent = "\t"
    }
    pack = JSON.parse(packStr)
} catch {
    console.warn("X No package.json found in the current directory")
}
if (!pack) {
    process.exit(1)
}
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
            const tools = ["npm", "npx pnpm", "pnpm", "npx bun", "bun"]
            if (tools.includes(customConfig.tool)) {
                config.tool = customConfig.tool
            } else {
                console.warn(`X Ignoring 'tool', must be: ${
                    tools.map(p => `'${p}'`).join(", ")}`)
            }
        }
        const cliArgs = Object.keys(config.cli)
        for (const cliArg of cliArgs) {
            if (typeof customConfig.cli?.[cliArg] === "boolean") {
                config.cli[cliArg] = customConfig.cli[cliArg]
            } else if (customConfig.cli?.[cliArg] !== undefined) {
                console.warn(`X Ignoring 'cli.${cliArg}', must be boolean`)
            }
        }
        /** @type {("audit"|"dedupe")[]} */
        const boolOpts = ["audit", "dedupe"]
        for (const arg of boolOpts) {
            if (typeof customConfig[arg] === "boolean") {
                config[arg] = customConfig[arg]
            } else if (customConfig[arg] !== undefined) {
                console.warn(`X Ignoring '${arg}', must be boolean`)
            }
        }
        const validPrefixes = ["", "<", ">", "<=", ">=", "=", "~", "^"]
        if (validPrefixes.includes(customConfig.prefixChar)) {
            config.prefixChar = customConfig.prefixChar
        } else if (customConfig.prefixChar !== undefined) {
            console.warn(`X Ignoring 'prefixChar', must be: ${
                validPrefixes.map(p => `'${p}'`).join(", ")}`)
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
const nusOverridesFile = join(process.cwd(), "nus.overrides.json")
if (existsSync(nusOverridesFile)) {
    try {
        const overrides = JSON.parse(readFileSync(nusOverridesFile).toString())
        if (typeof overrides === "object" && !Array.isArray(overrides)) {
            for (const [key, value] of Object.entries(overrides)) {
                if (typeof value !== "string") {
                    console.warn(`X Ignoring override '${
                        key}', value must be string`)
                    continue
                }
                config.overrides[key] = value
            }
        } else if (overrides !== undefined) {
            console.warn("X Ignoring 'nus.overrides.json' file, "
                + "must be a flat string-string object")
        }
    } catch {
        console.warn("X Ignoring 'nus.overrides.json' file, invalid JSON")
    }
}
let longestName = 20
for (const name of Object.keys(pack.dependencies || {})) {
    longestName = Math.max(longestName, name.length)
}
for (const name of Object.keys(pack.devDependencies || {})) {
    longestName = Math.max(longestName, name.length)
}
/** @type {("dependencies"|"devDependencies")[]} */
const depTypes = ["dependencies", "devDependencies"]
for (const depType of depTypes) {
    if (!pack[depType]) {
        continue
    }
    console.info(`= Updating ${depType} =`)
    for (const [name, version] of Object.entries(pack[depType])) {
        const paddedName = `${name.padEnd(longestName, " ")} `
        const {alias, verType} = findVersionType(name, version)
        const desired = config.overrides[name] ?? "latest"
        if (verType === "file" || verType === "git" || verType === "url") {
            const hash = desired.replace(/^#+/g, "")
            if (hash === "latest" || verType !== "git") {
                console.info(`- ${paddedName}${verType}`)
            } else {
                console.info(`- ${paddedName}git#${hash}`)
                // @ts-expect-error Indexing does not take depType into account
                pack[depType][name] = `${version.split("#")[0]}#${hash}`
            }
        } else {
            const wanted = findWantedVersion({
                alias, desired, name, paddedName, version, verType
            })
            if (wanted) {
                // @ts-expect-error Indexing does not take depType into account
                pack[depType][name] = wanted
            }
        }
    }
}
console.info(`= Installing =`)
writeFileSync(packageJson, `${JSON.stringify(pack, null, indent)}\n`)
rmSync(join(process.cwd(), "package-lock.json"), {"force": true})
rmSync(join(process.cwd(), "pnpm-lock.yaml"), {"force": true})
rmSync(join(process.cwd(), "bun.lock"), {"force": true})
rmSync(join(process.cwd(), "node_modules"), {"force": true, "recursive": true})
let installArgs = ""
let auditArgs = ""
let dedupeArgs = ""
if (config.cli.force) {
    installArgs += " --force"
}
if (config.tool === "npm" && config.cli.foregroundScripts) {
    installArgs += " --foreground-scripts"
}
if (config.tool === "npm" && config.cli.fundHide) {
    installArgs += " --no-fund"
    auditArgs += " --no-fund"
    dedupeArgs += " --no-fund"
}
if (config.cli.global) {
    installArgs += " --global"
    auditArgs += " --global"
    dedupeArgs = " --global"
}
if (config.cli.ignoreScripts) {
    installArgs += " --ignore-scripts"
}
if (config.cli.legacy) {
    if (config.tool === "npm") {
        installArgs += " --legacy-peer-deps"
        dedupeArgs = " --legacy-peer-deps"
    } else {
        installArgs += " --strict-peer-dependencies=false"
        dedupeArgs += " --strict-peer-dependencies=false"
    }
}
if (config.cli.silent) {
    installArgs += " --loglevel=silent"
    auditArgs += " --loglevel=silent"
    dedupeArgs += " --loglevel=silent"
}
if (config.cli.verbose) {
    installArgs += " --loglevel=verbose"
    auditArgs += " --loglevel=verbose"
    dedupeArgs += " --loglevel=verbose"
}
execSync(`${config.tool} install${installArgs}`,
    {"encoding": "utf8", "stdio": "inherit"})
if (config.audit) {
    execSync(`${config.tool} audit fix${auditArgs}`,
        {"encoding": "utf8", "stdio": "inherit"})
}
if (config.dedupe && !config.tool.endsWith("bun")) {
    execSync(`${config.tool} dedupe${dedupeArgs}`,
        {"encoding": "utf8", "stdio": "inherit"})
}
