const CTRL_C = "\u0003"
const BACKSPACE = "\u007f"
const CTRL_BACKSPACE = "\u0017"
const ARROW_ESC = "\u001b["

/** Set raw mode for process stdin, so that each character is read directly. */
const enableRaw = () => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding("utf8")
}

/** Disable raw mode and pause the accepting of stdin characters entirely. */
const disableRaw = () => {
    process.stdin.setRawMode(false)
    process.stdin.pause()
}

/**
 * Filter options by checking for each character to be present in the string.
 * @param {string[]} options
 * @param {string} query
 */
const filter = (options, query) => options.filter(s => {
    if (!query) {
        return true
    }
    let i = 0
    for (const ch of s.toLowerCase()) {
        if (ch === query.toLowerCase()[i]) {
            i += 1
        }
        if (i === query.length) {
            return true
        }
    }
    return false
})

/**
 * Generate a string to show as the inline window based on the list and index.
 * @param {string[]} list
 * @param {number} index
 */
const inlineWindow = (list, index) => {
    if (list.length === 0) {
        return ""
    }
    const max = Math.min(3, list.length)
    let start = index - Math.floor(max / 2)
    if (start < 0) {
        start = 0
    }
    if (start + max > list.length) {
        start = list.length - max
    }
    return list.slice(start, start + max).map((v, idx) => {
        if (start + idx === index) {
            return `<${v}>`
        }
        return v
    }).join(", ")
}

/**
 * Select a value from the options list with search or arrow keys.
 * @param {string} prompt - The prompt to show before the inline selector.
 * @param {string[]} options - The list of options that can be selected.
 * @param {string|null} firstSelection - Initial selection from the list.
 * @returns {Promise<string>}
 */
const select = (prompt, options, firstSelection) => new Promise(resolve => {
    enableRaw()
    let query = ""
    /** @type {string[]} */
    let matches = []
    let selectedIndex = -1
    if (firstSelection) {
        selectedIndex = options.indexOf(firstSelection)
    }

    /** Update the filtered matches, selected index and show updated prompt. */
    const updateMatches = () => {
        matches = filter(options, query)
        if (!matches[selectedIndex]) {
            selectedIndex = 0
        }
        process.stdout.clearLine(0)
        process.stdout.cursorTo(0)
        const inline = inlineWindow(matches, selectedIndex)
        process.stdout.write(`${prompt} [${inline}]: ${query}`)
    }

    /**
     * Handle the new inputted character, either update the selection or exit.
     * @param {string} ch
     */
    const onData = ch => {
        if (ch === CTRL_C) {
            disableRaw()
            console.info("^C")
            process.exit(1)
        }
        if (["\r", "\n"].includes(ch) && matches[selectedIndex]) {
            process.stdin.removeListener("data", onData)
            disableRaw()
            process.stdout.clearLine(0)
            process.stdout.cursorTo(0)
            resolve(matches[selectedIndex])
        }
        if (ch.startsWith(ARROW_ESC) && ch.length >= 3) {
            if ((ch[2] === "A" || ch[2] === "C") && matches.length > 0) {
                selectedIndex = Math.min(matches.length - 1, selectedIndex + 1)
                updateMatches()
            }
            if ((ch[2] === "B" || ch[2] === "D") && matches.length > 0) {
                selectedIndex = Math.max(0, selectedIndex - 1)
                updateMatches()
            }
        }
        if (ch === CTRL_BACKSPACE && query.length > 0) {
            query = ""
            updateMatches()
        }
        if (ch === BACKSPACE && query.length > 0) {
            query = query.slice(0, -1)
            updateMatches()
        }
        // This includes most readable characters, except for space itself
        if (ch > " " && ch <= "~") {
            query += ch
            updateMatches()
        }
    }

    process.stdin.on("data", onData)
    updateMatches()
})

export default select
