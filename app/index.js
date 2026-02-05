#!/usr/bin/env node

import installer from "./installer.js"
import updater from "./updater.js"

await updater()
installer()
