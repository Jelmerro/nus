import {getVersionsBatch} from "fast-npm-meta"
import {execSync} from "node:child_process"
import {readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import lt from "semver/functions/lt.js"
import maxSatisfying from "semver/ranges/max-satisfying.js"
import config from "./config.js"
import ask from "./select.js"

const packageJsonFile = join(process.cwd(), "package.json")

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
 *   "distTags": {[name: string]: string|null},
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
                "distTags": JSON.parse(execSync(distCmd, cmdOpts).toString()),
                "time": JSON.parse(execSync(timeCmd, cmdOpts).toString())
            }
        }
        const cmd = `${config.tool} view ${pkg} --json time dist-tags`
        const parsed = JSON.parse(execSync(cmd, cmdOpts).toString())
        return {"distTags": parsed["dist-tags"], "time": parsed.time}
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
 *   desired: string,
 *   latest: string,
 *   newest: string|null,
 *   paddedName: string,
 *   version: string,
 *   wanted: string,
 * }} opts
 */
const logResultToUser = ({
    desired, latest, newest, paddedName, version, wanted
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
}

/**
 * Update a package to the latest version based on the configured policy.
 * @param {{
 *   versionInfo: import("fast-npm-meta").PackageVersionsInfo|undefined,
 *   name: string,
 *   paddedName: string,
 *   version: string
 * }} options
 */
const updatePackage = async({name, paddedName, version, versionInfo}) => {
    const {alias, verType} = findVersionType(name, version)
    let desired = config.overrides[name] ?? "latest"
    if (verType === "file" || verType === "git" || verType === "url") {
        const hash = desired.replace(/^#+/g, "")
        if (hash === "latest" || verType !== "git") {
            console.info(`- ${paddedName}${verType}`)
        } else {
            console.info(`- ${paddedName}git#${hash}`)
            return `${version.split("#")[0]}#${hash}`
        }
        return version
    }
    const info = versionInfo ?? fetchVersionInfo({"alias": alias ?? null, name})
    if (!info?.distTags?.latest || !info?.time) {
        console.info(`X ${paddedName}${version} @${desired}`)
        console.warn(`X Failed, ${config.tool} request error`)
        return version
    }
    const {
        allowedVersions, allVersions
    } = versionInfoToAllowedVersions(info.time)
    const wantedInfo = findWantedVersion({
        allowedVersions,
        allVersions,
        desired,
        paddedName,
        "tags": info.distTags,
        version
    })
    if (!wantedInfo) {
        return version
    }
    const versionStatus = {
        "blocked": version === wantedInfo.wanted
            && wantedInfo.wanted !== info.distTags.latest,
        "latest": version !== wantedInfo.wanted
            && wantedInfo.wanted === info.distTags.latest,
        "semi": version !== wantedInfo.wanted
            && wantedInfo.wanted !== info.distTags.latest
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
            desired,
            "latest": info.distTags.latest,
            "newest": wantedInfo.newest,
            paddedName,
            version,
            "wanted": wantedInfo.wanted
        })
        const selected = await ask(
            `Select ${name} version`, allVersions, wantedInfo.wanted)
        wantedInfo.wanted = selected
        if (selected === info.distTags.latest) {
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
        desired,
        "latest": info.distTags.latest,
        "newest": wantedInfo.newest,
        paddedName,
        version,
        "wanted": wantedInfo.wanted
    })
    if (alias) {
        return `npm:${alias}@${wantedInfo.wanted}`
    }
    return wantedInfo.wanted
}

/** Read the package json and return all info and the detected indentation. */
const readPackageJson = () => {
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
        const packStr = readFileSync(packageJsonFile,
            {"encoding": "utf8"}).toString()
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
    return {indent, pack}
}

/** Read package.json, update each package, then write back with same indent. */
const updater = async() => {
    const {indent, pack} = readPackageJson()
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
    /** @type {string[]} */
    const packageList = []
    for (const depType of depTypes) {
        if (pack[depType]) {
            for (const name of Object.keys(pack[depType])) {
                const {verType} = findVersionType(name, pack[depType][name])
                if (verType === "semver") {
                    packageList.push(name)
                }
                longestName = Math.max(longestName, name.length)
            }
        }
    }
    /** @type {import("fast-npm-meta").PackageVersionsInfo[]} */
    let bulkFetchedInfo = []
    try {
        bulkFetchedInfo = await getVersionsBatch(packageList, {"retry": 1})
    } catch {
        console.warn(`X Failed, fast-npm-meta request error`)
    }
    for (const depType of depTypes) {
        if (!pack[depType]) {
            continue
        }
        console.info(`= Updating ${depType} =`)
        for (const [name, version] of Object.entries(pack[depType])) {
            const paddedName = `${name.padEnd(longestName, " ")} `
            const versionInfo = bulkFetchedInfo.find(i => i.name === name)
            pack[depType][name] = await updatePackage(
                {name, paddedName, version, versionInfo})
        }
    }
    writeFileSync(packageJsonFile, `${JSON.stringify(pack, null, indent)}\n`)
}

export default updater
