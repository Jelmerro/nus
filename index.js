#!/usr/bin/env node
"use strict"

const {join} = require("path")
const {writeFileSync, readFileSync, rmSync} = require("fs")
const {execSync} = require("child_process")
const {maxSatisfying} = require("semver")

const overrides = {}
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
    "prefixChar": ""
}
const packageJson = join(process.cwd(), "package.json")
let pack = {}

/**
 * Find the version of a package by direct version matching or semver range.
 * @param {string} name - The name of the package.
 * @param {string} range - The version range to search for.
 */
const findByRange = (name, range) => {
    const info = execSync(`npm show ${
        name} versions --json`, {"encoding": "utf8"})
    const versions = JSON.parse(info)
    if (versions.includes(range)) {
        return range
    }
    return maxSatisfying(versions, range)
}

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
    console.warn("X No package.json found in the current directory, all done.")
    process.exit(1)
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
            `npm show ${name} --json`, {"encoding": "utf8"}))
        let latest = info?.["dist-tags"]?.latest
        const desired = overrides[name] ?? "latest"
        if (desired === "latest" && config.prefixChar) {
            latest = config.prefixChar + latest
        }
        let wanted = latest
        if (desired !== "latest") {
            wanted = info?.["dist-tags"]?.[desired]
                ?? findByRange(name, desired)
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
    execSync(`npm audit fix${args}`, {"encoding": "utf8", "stdio": "inherit"})
}
