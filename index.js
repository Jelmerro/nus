#!/usr/bin/env node
"use strict"

const {join} = require("path")
const {writeFileSync, readFileSync, rmSync, existsSync} = require("fs")
const {execSync} = require("child_process")
const {maxSatisfying} = require("semver")

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

const config = {
    "audit": true,
    "dedup": true,
    "indent": 4,
    "npm": {
        "force": false,
        "global": false,
        "legacy": false,
        "silent": false,
        "verbose": false
    },
    "overrides": {},
    "prefixChar": ""
}
const packageJson = join(process.cwd(), "package.json")
let pack = {}
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
    try {
        const customConfig = require(nusConfigFile)
        const npmArgs = ["force", "global", "legacy", "silent", "verbose"]
        for (const npmArg of npmArgs) {
            if (typeof customConfig?.npm?.[npmArg] === "boolean") {
                config.npm[npmArg] = customConfig.npm[npmArg]
            } else if (customConfig?.npm?.[npmArg] !== undefined) {
                console.warn(`X Ignoring config for 'npm.${
                    npmArg}', must be boolean`)
            }
        }
        for (const arg of ["audit", "dedup"]) {
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
    } catch {
        console.warn("X Ignoring 'nus.config.js' config, invalid JS")
    }
}
const nusOverridesFile = join(process.cwd(), "nus.overrides.json")
if (existsSync(nusOverridesFile)) {
    try {
        const overrides = JSON.parse(readFileSync(nusOverridesFile))
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
for (const name of Object.keys(pack.dependencies ?? {})) {
    longestName = Math.max(longestName, name.length)
}
for (const name of Object.keys(pack.devDependencies ?? {})) {
    longestName = Math.max(longestName, name.length)
}
for (const depType of ["dependencies", "devDependencies"]) {
    if (!pack[depType]) {
        continue
    }
    console.info(`= Updating ${depType} =`)
    for (const [name, version] of Object.entries(pack[depType])) {
        const paddedName = `${name.padEnd(longestName, " ")} `
        if (version.startsWith("git+") || version.startsWith("github:")) {
            console.info(`- ${paddedName}git`)
            continue
        }
        const info = JSON.parse(execSync(
            `npm view ${name} --json`, {"encoding": "utf8"}))
        const desired = config.overrides[name] ?? "latest"
        if (!info?.["dist-tags"] || !info?.versions) {
            console.info(`X ${paddedName}${version} (${desired})`)
            console.warn(`X Failed, npm request for ${
                name} gave invalid info, sticking to ${version}`)
            continue
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
            continue
        }
        if (wanted === version) {
            console.info(`  ${paddedName}${version} (${desired})`)
        } else {
            console.info(`> ${paddedName}${
                version} => ${wanted} (${desired})`)
        }
        if (wanted !== latest) {
            console.info(`  (latest is ${latest})`)
        }
        pack[depType][name] = wanted
    }
}
console.info(`= Installing =`)
writeFileSync(packageJson, `${JSON.stringify(pack, null, config.indent)}\n`)
rmSync(join(process.cwd(), "package-lock.json"), {"force": true})
rmSync(join(process.cwd(), "node_modules"), {"force": true, "recursive": true})
let args = ""
if (config.npm.force) {
    args += " --force"
}
if (config.npm.global) {
    args += " --global"
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
