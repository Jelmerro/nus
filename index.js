#!/usr/bin/env node

import {execSync} from "node:child_process"
import {existsSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import maxSatisfying from "semver/ranges/max-satisfying.js"

const config = {
    "audit": true,
    "dedup": true,
    /** @type {number|"\t"} */
    "indent": 4,
    /** @type {number} */
    "minimumReleasedDaysAgo": 0,
    "npm": {
        "force": false,
        "global": false,
        "ignoreScripts": false,
        "legacy": false,
        "silent": false,
        "verbose": false
    },
    /** @type {{[name: string]: string}} */
    "overrides": {},
    "prefixChar": ""
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
    /** @type {{
     *   "dist-tags": {[name: string]: string|null},
     *   "time": {[version: string]: string},
     *   "versions": string[]
     * }|null} */
    let info = null
    try {
        info = JSON.parse(execSync(
            `npm view ${alias ?? name} --json dist-tags time`,
            {"encoding": "utf8"}))
        // Map keys of time object to build versions array
        if (info) {
            info.versions = Object.keys(info.time)
        }
    } catch {
        // Can't update package without this info, next if will be entered.
    }
    if (!info?.["dist-tags"] || !info?.time) {
        console.info(`X ${paddedName}${version} (${desired})`)
        console.warn(`X Failed, npm request for ${
            name} gave invalid info, sticking to ${version}`)
        return null
    }
    let {latest} = info["dist-tags"]
    if (desired === "latest" && config.prefixChar) {
        latest = config.prefixChar + latest
    }
    let wanted = latest
    // Check minimum release age if configured
    let moreRecentVersion = null
    if (config.minimumReleasedDaysAgo > 0 && desired === "latest") {
        const dayInMs = 24 * 60 * 60 * 1000
        const minimumAge = Date.now() - config.minimumReleasedDaysAgo * dayInMs
        info.versions = info.versions.filter(
            v => new Date(info.time[v]).getTime() <= minimumAge
        )
        wanted = findByRange(info.versions, `<=${latest}`)
        if (wanted !== latest) {
            moreRecentVersion = latest
        }
    }
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
    if (wanted === version) {
        console.info(`  ${paddedName}${version} (${desired})`)
    } else {
        console.info(`> ${paddedName}${
            version} => ${wanted} (${desired})`)
    }
    if (moreRecentVersion) {
        console.info(`  ${paddedName}latest too recent: ${moreRecentVersion}`)
    }
    if (desired !== "latest") {
        console.info(`  ${paddedName}(latest is ${latest})`)
    }
    return wanted
}

const packageJson = join(process.cwd(), "package.json")
/** @type {import('./package.json')|null} */
let pack = null
try {
    const packStr = readFileSync(packageJson, {"encoding": "utf8"}).toString()
    const line = packStr.split("\n").find(
        l => l.startsWith(" ") || l.startsWith("\t")) ?? ""
    config.indent = line.search(/\S|$/) ?? config.indent
    if (line.startsWith("\t")) {
        config.indent = "\t"
    }
    pack = JSON.parse(packStr)
} catch {
    console.warn("X No package.json found in the current directory")
    process.exit(1)
}
const nusConfigFile = join(process.cwd(), "nus.config.js")
if (existsSync(nusConfigFile)) {
    let customConfig = null
    try {
        customConfig = await import(nusConfigFile)
        customConfig = customConfig.default ?? customConfig
    } catch {
        console.warn("X Ignoring 'nus.config.js' config, invalid JS")
    }
    if (customConfig) {
        /** @type {(keyof typeof config.npm)[]} */
        const npmArgs = [
            "force",
            "global",
            "ignoreScripts",
            "legacy",
            "silent",
            "verbose"
        ]
        for (const npmArg of npmArgs) {
            if (typeof customConfig?.npm?.[npmArg] === "boolean") {
                config.npm[npmArg] = customConfig.npm[npmArg]
            } else if (customConfig?.npm?.[npmArg] !== undefined) {
                console.warn(`X Ignoring config for 'npm.${
                    npmArg}', must be boolean`)
            }
        }
        /** @type {("audit"|"dedup")[]} */
        const boolOpts = ["audit", "dedup"]
        for (const arg of boolOpts) {
            if (typeof customConfig?.[arg] === "boolean") {
                config[arg] = customConfig[arg]
            } else if (customConfig[arg] !== undefined) {
                console.warn(`X Ignoring config for 'npm.${
                    arg}', must be boolean`)
            }
        }
        if (customConfig.indent === "\t" || customConfig.indent === "\\t") {
            config.indent = "\t"
        } else if (typeof customConfig.indent === "number") {
            config.indent = customConfig.indent
        } else if (customConfig.indent !== undefined) {
            console.warn("X Ignoring config for 'indent', "
                + "must be number or '\\t'")
        }
        if (typeof customConfig.minimumReleasedDaysAgo === "number"
            && customConfig.minimumReleasedDaysAgo > 0) {
            config.minimumReleasedDaysAgo = customConfig.minimumReleasedDaysAgo
        } else if (customConfig.minimumReleasedDaysAgo !== undefined) {
            console.warn("X Ignoring config for 'minimumReleasedDaysAgo', "
                + "must be a non-negative number")
        }
        const validPrefixes = ["", "<", ">", "<=", ">=", "=", "~", "^"]
        if (validPrefixes.includes(customConfig.prefixChar)) {
            config.prefixChar = customConfig.prefixChar
        } else if (customConfig.prefixChar !== undefined) {
            console.warn(`X Ignoring config for 'prefixChar', must be one of: ${
                validPrefixes.join(" ")}`)
        }
        if (typeof customConfig.overrides === "object") {
            for (const [key, value] of Object.entries(customConfig.overrides)) {
                if (typeof value !== "string") {
                    console.warn(`X Ignoring override '${key}',`
                        + " value must be string")
                    continue
                }
                config.overrides[key] = value
            }
        } else if (customConfig.overrides !== undefined) {
            console.warn("X Ignoring config for 'overrides', "
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
                    console.warn(`X Ignoring override '${key}',`
                        + " value must be string")
                    continue
                }
                config.overrides[key] = value
            }
        } else if (overrides !== undefined) {
            console.warn("X Ignoring config from 'nus.overrides.json', "
                + "must be a flat string-string object")
        }
    } catch {
        console.warn("X Ignoring 'nus.overrides.json' config, invalid JSON")
    }
}
let longestName = 20
if (pack?.dependencies) {
    for (const name of Object.keys(pack.dependencies)) {
        longestName = Math.max(longestName, name.length)
    }
}
if (pack?.devDependencies) {
    for (const name of Object.keys(pack.devDependencies)) {
        longestName = Math.max(longestName, name.length)
    }
}
/** @type {("dependencies"|"devDependencies")[]} */
const depTypes = ["dependencies", "devDependencies"]
for (const depType of depTypes) {
    if (!pack || !pack[depType]) {
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
writeFileSync(packageJson, `${JSON.stringify(pack, null, config.indent)}\n`)
rmSync(join(process.cwd(), "package-lock.json"), {"force": true})
rmSync(join(process.cwd(), "node_modules"), {"force": true, "recursive": true})
let args = " --no-fund"
if (config.npm.force) {
    args += " --force"
}
if (config.npm.global) {
    args += " --global"
}
if (config.npm.ignoreScripts) {
    args += " --ignore-scripts"
}
if (config.npm.legacy) {
    args += " --legacy-peer-deps"
}
if (config.npm.silent) {
    args += " --silent"
}
if (config.npm.verbose) {
    args += " --verbose"
}
execSync(`npm install${args}`, {"encoding": "utf8", "stdio": "inherit"})
if (config.audit) {
    execSync(`npm audit fix${args}`, {"encoding": "utf8", "stdio": "inherit"})
}
if (config.dedup) {
    execSync(`npm dedup${args}`, {"encoding": "utf8", "stdio": "inherit"})
}
