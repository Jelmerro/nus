import {execSync} from "node:child_process"
import {rmSync} from "node:fs"
import {join} from "node:path"
import config from "./config.js"

const sharedInstallArgs = () => {
    let installArgs = ""
    if (config.cli.force) {
        installArgs += " --force"
    }
    if (config.cli.global) {
        installArgs += " --global"
    }
    if (config.cli.ignoreScripts) {
        installArgs += " --ignore-scripts"
    }
    if (config.cli.loglevel !== "notice") {
        installArgs += ` --loglevel=${config.cli.loglevel}`
    }
    return installArgs
}

const installWithNpm = () => {
    let installArgs = sharedInstallArgs()
    if (config.install === "prod") {
        installArgs += " --omit=dev"
    }
    if (config.dedupe) {
        installArgs += " --prefer-dedupe"
    }
    if (config.cli.foregroundScripts) {
        installArgs += " --foreground-scripts"
    }
    if (config.cli.fundHide) {
        installArgs += " --no-fund"
    }
    if (config.cli.legacy) {
        installArgs += " --legacy-peer-deps"
    }
    execSync(`${config.tool} install${installArgs}`,
        {"encoding": "utf8", "stdio": "inherit"})
}

const installWithPnpm = () => {
    let installArgs = sharedInstallArgs()
    let dedupeArgs = ""
    if (config.install === "prod") {
        installArgs += " --prod"
    }
    if (config.install === "prod") {
        dedupeArgs += " --prod"
    }
    if (config.cli.global) {
        dedupeArgs = " --global"
    }
    if (config.cli.legacy) {
        installArgs += " --strict-peer-dependencies=false"
        dedupeArgs += " --strict-peer-dependencies=false"
    }
    execSync(`${config.tool} install${installArgs}`,
        {"encoding": "utf8", "stdio": "inherit"})
    if (config.dedupe) {
        execSync(`${config.tool} dedupe${dedupeArgs}`,
            {"encoding": "utf8", "stdio": "inherit"})
    }
}

const installWithBun = () => {
    let installArgs = sharedInstallArgs()
    if (config.install === "prod") {
        installArgs += " --omit=dev"
    }
    if (config.cli.legacy) {
        installArgs += " --strict-peer-dependencies=false"
    }
    execSync(`${config.tool} install${installArgs}`,
        {"encoding": "utf8", "stdio": "inherit"})
}

/** Clear all lock files and node_modules, then re-install clean with args. */
const install = () => {
    if (config.install) {
        console.info(`= Installing =`)
    }
    rmSync(join(process.cwd(), "package-lock.json"), {"force": true})
    rmSync(join(process.cwd(), "pnpm-lock.yaml"), {"force": true})
    rmSync(join(process.cwd(), "bun.lock"), {"force": true})
    rmSync(join(process.cwd(), "node_modules"),
        {"force": true, "recursive": true})
    if (!config.install) {
        process.exit(0)
    }
    if (config.tool === "npm") {
        installWithNpm()
    } else if (config.tool.endsWith("pnpm")) {
        installWithPnpm()
    } else if (config.tool.endsWith("bun")) {
        installWithBun()
    }
}

export default install
