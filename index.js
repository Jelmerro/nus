#!/usr/bin/env node

import {execSync} from "node:child_process"
import {existsSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import lt from "semver/functions/lt.js"
import maxSatisfying from "semver/ranges/max-satisfying.js"
import ask from "./select.js"

/**
 * @typedef {"all"|"latest"|"nonlatest"|"semi"|"changed"|"blocked"|"none"}
 * AskLevel
 */

const config = {
    /** @type {AskLevel} */
    "ask": "none",
    /** @type {boolean|"prod"} */
    "audit": true,
    "cli": {
        "force": false,
        "foregroundScripts": true,
        "fundHide": true,
        "global": false,
        "ignoreScripts": false,
        "legacy": false,
        /** @type {"silent"|"error"|"warn"|"notice"|"info"|"verbose"|"silly"} */
        "loglevel": "notice"
    },
    "dedupe": true,
    "deps": {
        "dev": true,
        "optional": false,
        "peer": false,
        "prod": true
    },
    /** @type {boolean|"prod"} */
    "install": true,
    "minAge": 0,
    /** @type {{[name: string]: string}} */
    "overrides": {},
    /** @type {"npm"|"npx pnpm"|"pnpm"|"npx bun"|"bun"} */
    "tool": "npm"
}
const askLevels = ["all", "latest", "nonlatest", "semi", "changed", "blocked"]

/**
 * Check if a string is a valid ask level or not.
 * @param {string} level
 * @returns {level is AskLevel}
 */
const isValidAskLevel = level => askLevels.includes(level)

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
 * Fetch the required version information using the configured tool.
 * @param {{alias: string|null, name: string}} opts
 * @returns {{
 *   "dist-tags": {[name: string]: string|null},
 *   "time": {[version: string]: string|null},
 * }|null}
 */
const fetchVersionInfo = ({alias, name}) => {
    try {
        const pkg = alias ?? name
        /** @type {import("node:child_process").ExecSyncOptions} */
        const cmdOpts = {
            "encoding": "utf8", "stdio": ["ignore", "pipe", "ignore"]
        }
        if (config.tool.endsWith("bun")) {
            const distCmd = `${config.tool} info ${pkg} --json dist-tags`
            const timeCmd = `${config.tool} info ${pkg} --json time`
            return {
                "dist-tags": JSON.parse(execSync(distCmd, cmdOpts).toString()),
                "time": JSON.parse(execSync(timeCmd, cmdOpts).toString())
            }
        }
        const cmd = `${config.tool} view ${pkg} --json time dist-tags`
        return JSON.parse(execSync(cmd, cmdOpts).toString())
    } catch {
        return null
    }
}

/**
 * Convert the release times to a list of versions and allowed versions.
 * @param {{[version: string]: string|null}} releaseTimes
 */
const versionInfoToAllowedVersions = releaseTimes => {
    const allVersions = Object.keys(releaseTimes)
        .filter(v => v !== "modified" && v !== "created")
    const minAge = Date.now() - config.minAge * 1000 * 60
    const allowedVersions = allVersions.filter(v => {
        const releaseTime = releaseTimes[v]
        if (!releaseTime) {
            return false
        }
        return new Date(releaseTime).getTime() <= minAge
    })
    return {allowedVersions, allVersions}
}

/**
 * Find the wanted version for a given package based on desired version string.
 * @param {{
 *   allowedVersions: string[],
 *   allVersions: string[],
 *   desired: string,
 *   paddedName: string,
 *   tags: {[tag: string]: string|null},
 *   version: string
 * }} opts
 */
const findWantedVersion = ({
    allowedVersions, allVersions, desired, paddedName, tags, version
}) => {
    let desiredRange = desired
    if (tags[desired]) {
        desiredRange = `<=${tags[desired]}`
    }
    const wanted = findByRange(allowedVersions, desiredRange)
    const newest = findByRange(allVersions, desiredRange)
    if (newest && wanted !== newest && (!wanted || lt(wanted, version))) {
        console.info(`X ${paddedName}${version} @${desired} !${newest}`)
        console.warn(`X Failed, current and more recent versions too new`)
        return null
    }
    if (!wanted) {
        console.info(`X ${paddedName}${version} @${desired}`)
        console.warn(`X Failed, no ${desired} version found`)
        return null
    }
    return {newest, wanted}
}

/**
 * Log the result of wanted, newest, latest and desired versions to the screen.
 * @param {{
 *   alias: string|null,
 *   desired: string,
 *   latest: string,
 *   newest: string|null,
 *   paddedName: string,
 *   version: string,
 *   wanted: string,
 * }} opts
 */
const logResultToUser = ({
    alias, desired, latest, newest, paddedName, version, wanted
}) => {
    let status = "  "
    let policy = ""
    let tooNew = ""
    if (newest && wanted !== newest) {
        status = "! "
        tooNew = ` !${newest}`
    }
    if (desired !== "latest") {
        status = "~ "
        policy = ` @${desired}`
        if (desired !== latest) {
            policy += ` ~${latest}`
        }
    }
    let update = ""
    if (wanted !== version) {
        status = "> "
        update = ` > ${wanted}`
    }
    console.info(`${status}${paddedName}${version}${update}${policy}${tooNew}`)
    if (alias) {
        return `npm:${alias}@${wanted}`
    }
    return wanted
}

const packageJson = join(process.cwd(), "package.json")
/**
 * @type {(
 *     import('./package.json')
 *     & {"dependencies": {[name: string]: string}}
 *     & {"devDependencies": {[name: string]: string}}
 *     & {"optionalDependencies": {[name: string]: string}}
 *     & {"peerDependencies": {[name: string]: string}}
 * )|null}
 */
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
        for (const cliArg of Object.keys(config.cli)) {
            if (cliArg === "loglevel") {
                const loglevels = [
                    "silent",
                    "error",
                    "warn",
                    "notice",
                    "info",
                    "verbose",
                    "silly"
                ]
                if (loglevels.includes(customConfig.cli?.[cliArg])) {
                    config.cli[cliArg] = customConfig.cli[cliArg]
                } else if (customConfig.cli?.[cliArg] !== undefined) {
                    console.warn(`X Ignoring 'cli.${cliArg}', must be one of:`
                        + ` ${loglevels.join(", ")}`)
                }
            } else if (typeof customConfig.cli?.[cliArg] === "boolean") {
                config.cli[cliArg] = customConfig.cli[cliArg]
            } else if (customConfig.cli?.[cliArg] !== undefined) {
                console.warn(`X Ignoring 'cli.${cliArg}', must be boolean`)
            }
        }
        /** @type {("audit"|"dedupe"|"install")[]} */
        const boolOpts = ["audit", "dedupe", "install"]
        for (const arg of boolOpts) {
            if (typeof customConfig[arg] === "boolean") {
                config[arg] = customConfig[arg]
            } else if (arg === "dedupe") {
                if (customConfig[arg] !== undefined) {
                    console.warn(`X Ignoring '${arg}', must be boolean`)
                }
            } else if (customConfig[arg] === "prod") {
                config[arg] = "prod"
            } else if (customConfig[arg] !== undefined) {
                console.warn(`X Ignoring '${arg}', must be boolean or "prod"`)
            }
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
 * Print command line interface usage and exit with code.
 * @param {number} code
 */
const printUsage = (code = 1) => {
    console.info(`nus: Node update script

Usage: nus [options]

Options:
 --help              Print this help and exit.

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
See the LICENSE file or the website for details.`)
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
/**
 * @type {{[name: string]: "dependencies"|"devDependencies"
 *     |"peerDependencies"|"optionalDependencies"}}
 */
const depNameTranslateObj = {
    "dev": "devDependencies",
    "optional": "optionalDependencies",
    "peer": "peerDependencies",
    "prod": "dependencies"
}
const depTypes = Object.keys(config.deps).filter(d => config.deps[d])
    .map(d => depNameTranslateObj[d])
let longestName = 20
for (const depType of depTypes) {
    if (pack[depType]) {
        for (const name of Object.keys(pack[depType])) {
            longestName = Math.max(longestName, name.length)
        }
    }
}
for (const depType of depTypes) {
    if (!pack[depType]) {
        continue
    }
    console.info(`= Updating ${depType} =`)
    for (const [name, version] of Object.entries(pack[depType])) {
        const paddedName = `${name.padEnd(longestName, " ")} `
        const {alias, verType} = findVersionType(name, version)
        let desired = config.overrides[name] ?? "latest"
        if (verType === "file" || verType === "git" || verType === "url") {
            const hash = desired.replace(/^#+/g, "")
            if (hash === "latest" || verType !== "git") {
                console.info(`- ${paddedName}${verType}`)
            } else {
                console.info(`- ${paddedName}git#${hash}`)
                pack[depType][name] = `${version.split("#")[0]}#${hash}`
            }
        } else {
            const info = fetchVersionInfo({"alias": alias ?? null, name})
            if (!info?.["dist-tags"]?.latest || !info?.time) {
                console.info(`X ${paddedName}${version} @${desired}`)
                console.warn(`X Failed, ${config.tool} request error`)
                continue
            }
            const {
                allowedVersions, allVersions
            } = versionInfoToAllowedVersions(info.time)
            const wantedInfo = findWantedVersion({
                allowedVersions,
                allVersions,
                desired,
                paddedName,
                "tags": info["dist-tags"],
                version
            })
            if (!wantedInfo) {
                continue
            }
            const versionStatus = {
                "blocked": version === wantedInfo.wanted
                    && wantedInfo.wanted !== info["dist-tags"].latest,
                "latest": version !== wantedInfo.wanted
                    && wantedInfo.wanted === info["dist-tags"].latest,
                "semi": version !== wantedInfo.wanted
                    && wantedInfo.wanted !== info["dist-tags"].latest
            }
            const shouldAskVersion = config.ask === "all" || [
                config.ask === "blocked" && versionStatus.blocked,
                config.ask === "semi" && versionStatus.semi,
                config.ask === "latest" && versionStatus.latest,
                config.ask === "nonlatest"
                    && (versionStatus.blocked || versionStatus.semi),
                config.ask === "changed"
                    && (versionStatus.latest || versionStatus.semi)
            ].some(Boolean)
            if (shouldAskVersion) {
                logResultToUser({
                    alias,
                    desired,
                    "latest": info["dist-tags"].latest,
                    "newest": wantedInfo.newest,
                    paddedName,
                    version,
                    "wanted": wantedInfo.wanted
                })
                const selected = await ask(
                    `Select ${name} version`, allVersions, wantedInfo.wanted)
                wantedInfo.wanted = selected
                if (selected === info["dist-tags"].latest) {
                    desired = "latest"
                } else {
                    desired = selected
                }
                wantedInfo.newest = null
                process.stdout.moveCursor(0, -1)
                process.stdout.clearLine(0)
                process.stdout.cursorTo(0)
            }
            logResultToUser({
                alias,
                desired,
                "latest": info["dist-tags"].latest,
                "newest": wantedInfo.newest,
                paddedName,
                version,
                "wanted": wantedInfo.wanted
            })
            pack[depType][name] = wantedInfo.wanted
        }
    }
}
if (config.install) {
    console.info(`= Installing =`)
}
writeFileSync(packageJson, `${JSON.stringify(pack, null, indent)}\n`)
rmSync(join(process.cwd(), "package-lock.json"), {"force": true})
rmSync(join(process.cwd(), "pnpm-lock.yaml"), {"force": true})
rmSync(join(process.cwd(), "bun.lock"), {"force": true})
rmSync(join(process.cwd(), "node_modules"), {"force": true, "recursive": true})
if (!config.install) {
    process.exit(0)
}
let installArgs = ""
let auditArgs = ""
let dedupeArgs = ""
if (config.install === "prod") {
    installArgs += " --omit=dev"
}
if (config.install === "prod" || config.audit === "prod") {
    auditArgs += " --omit=dev"
    dedupeArgs += " --omit=dev"
}
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
if (config.cli.loglevel !== "notice") {
    installArgs += ` --loglevel=${config.cli.loglevel}`
    auditArgs += ` --loglevel=${config.cli.loglevel}`
    dedupeArgs += ` --loglevel=${config.cli.loglevel}`
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
