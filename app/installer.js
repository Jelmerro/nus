import {execSync} from "node:child_process"
import {rmSync} from "node:fs"
import {join} from "node:path"
import config from "./config.js"

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
}

export default install
