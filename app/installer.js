import {execSync} from "node:child_process"
import {rmSync} from "node:fs"
import {join} from "node:path"
import config from "./config.js"

/** Clear all lock files and node_modules, then re-install clean with args. */
const install = () => {
    rmSync(join(process.cwd(), "package-lock.json"), {"force": true})
    rmSync(join(process.cwd(), "pnpm-lock.yaml"), {"force": true})
    rmSync(join(process.cwd(), "bun.lock"), {"force": true})
    rmSync(join(process.cwd(), "node_modules"),
        {"force": true, "recursive": true})
    if (config.install === "none") {
        process.exit(0)
    }
    console.info(`= Installing =`)
    let installArgs = ""
    if (config.install !== "all") {
        installArgs += " --ignore-scripts"
    }
    if (config.install === "prod") {
        installArgs += " --omit=dev"
    }
    if (config.tool === "npm") {
        installArgs += " --no-fund"
        if (config.dedupe) {
            installArgs += " --prefer-dedupe"
        }
    }
    if (config.tool.endsWith("pnpm")) {
        installArgs = installArgs.replace("--omit=dev", "--prod")
    }
    execSync(`${config.tool} install${installArgs}`,
        {"encoding": "utf8", "stdio": "inherit"})
    if (config.tool.endsWith("pnpm") && config.dedupe) {
        execSync(`${config.tool} dedupe${installArgs}`,
            {"encoding": "utf8", "stdio": "inherit"})
    }
}

export default install
