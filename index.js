#!/usr/bin/env node
"use strict"

const overrides = {}
const config = {
    "audit": true,
    "dedup": true,
    "indent": 2,
    "npm": {
        "force": false,
        "global": false,
        "legacy": false,
        "silent": false,
        "verbose": false
    },
    "prefixChar": ""
}

/**
 * Find the version of a package using a regex.
 * @param {string} text - The text to search in.
 * @param {string} version - The version to search for.
 */
const findVersion = (text, version) => {
    const regex = new RegExp(`${version}:\\s+(.+)(\\s+|$)`)
    const match = config.prefixChar + (regex.exec(text)?.[1] ?? "")
    return match || version
}

const {join} = require("path")
const {writeFileSync, readFileSync, rmSync} = require("fs")
const {execSync} = require("child_process")
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
    console.warn("No package.json found in the current directory, all done.")
    process.exit(1)
}
if (pack.repository === "https://github.com/Jelmerro/nus") {
    console.info("The nus package has no dependencies, no need to upate it.")
    process.exit(0)
}
for (const depType of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(pack[depType] ?? {})) {
        if (version.startsWith("git+") || version.startsWith("github:")) {
            console.info(`Updating ${name} to the latest git version`)
            continue
        }
        const info = execSync(`npm dist-tags ${name}`, {"encoding": "utf8"})
        const latest = findVersion(info, "latest")
        const custom = overrides[name] ?? "latest"
        let wanted = latest
        if (custom !== "latest") {
            wanted = findVersion(info, overrides[name])
        }
        if (!wanted || !latest) {
            console.error(`Failed to find ${wanted} version for ${name}`)
            continue
        }
        if (wanted === version) {
            console.info(`${name} already using the '${custom}' version ${version}`)
        } else {
            console.info(`Updating ${name} from ${version} to ${wanted}`)
        }
        if (wanted !== latest) {
            console.info(` the 'latest' version is at ${latest}`)
        }
        pack[depType][name] = wanted
    }
}
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
