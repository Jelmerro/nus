#!/usr/bin/env node

import {execSync} from "node:child_process"
import {readFileSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import lt from "semver/functions/lt.js"
import maxSatisfying from "semver/ranges/max-satisfying.js"
import config from "./config.js"
import ask from "./select.js"

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
 *     import('../package.json')
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
            continue
        }
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
