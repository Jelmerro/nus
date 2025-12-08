#!/usr/bin/env node

import {execSync} from "node:child_process"
import {existsSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import lt from "semver/functions/lt.js"
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
    "deps": {
        "dev": true,
        "optional": false,
        "peer": false,
        "prod": true
    },
    "install": true,
    "minAge": 0,
    /** @type {{[name: string]: string}} */
    "overrides": {},
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
 * Find the wanted version for a given package based on desired version string.
 * @param {{
 *   alias?: string|null,
 *   desired: string,
 *   name: string,
 *   paddedName: string,
 *   version: string,
 * }} opts
 */
const findWantedVersion = ({alias, desired, name, paddedName, version}) => {
    const info = fetchVersionInfo({"alias": alias ?? null, name})
    if (!info?.["dist-tags"] || !info?.time) {
        console.info(`X ${paddedName}${version} @${desired}`)
        console.warn(`X Failed, ${config.tool} request error`)
        return null
    }
    const allVersions = Object.keys(info.time)
        .filter(v => v !== "modified" && v !== "created")
    const minAge = Date.now() - config.minAge * 1000 * 60
    const allowedVersions = allVersions.filter(v => {
        const releaseTime = info.time[v]
        if (!releaseTime) {
            return false
        }
        return new Date(releaseTime).getTime() <= minAge
    })
    let desiredRange = desired
    if (info["dist-tags"][desired]) {
        desiredRange = `<=${info["dist-tags"][desired]}`
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
    let status = "  "
    let policy = ""
    let tooNew = ""
    if (wanted !== newest) {
        status = "! "
        tooNew = ` !${newest}`
    }
    if (desired !== "latest") {
        status = "~ "
        policy = ` @${desired}`
        if (desired !== info["dist-tags"].latest) {
            policy += ` ~${info["dist-tags"].latest}`
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
            if (typeof customConfig.cli?.[cliArg] === "boolean") {
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
            } else if (customConfig[arg] !== undefined) {
                console.warn(`X Ignoring '${arg}', must be boolean`)
            }
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
        const desired = config.overrides[name] ?? "latest"
        if (verType === "file" || verType === "git" || verType === "url") {
            const hash = desired.replace(/^#+/g, "")
            if (hash === "latest" || verType !== "git") {
                console.info(`- ${paddedName}${verType}`)
            } else {
                console.info(`- ${paddedName}git#${hash}`)
                pack[depType][name] = `${version.split("#")[0]}#${hash}`
            }
        } else {
            const wanted = findWantedVersion({
                alias, desired, name, paddedName, version
            })
            if (wanted) {
                pack[depType][name] = wanted
            }
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
