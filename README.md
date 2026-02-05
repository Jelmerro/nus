nus
===

Node Update Script - A script to update all node packages in a project.

## Features

- Always update to the latest including major (unless overridden using [semver ranges](https://github.com/npm/node-semver))
- Always do a clean install to update nested dependencies too
- Faster than most, as it will try to do it with a single web request via [fast-npm-meta](https://github.com/antfu/fast-npm-meta)
- Specify custom versions to use by tag, range or version (default is latest)
- Single command to update, install, audit and finally dedupe
- Optionally set a minAge to prevent very recent releases from being used
- Custom options for cli: force, ignore-scripts, legacy-peer-deps and more
- Built for npm first, there's also support for pnpm and bun, either global or via npx
- Exact versions in package.json to avoid confusion and surprises
- Optionally ask before applying updates and choose a custom version from a list
- Clean CLI output: name, old version, new version, update policy, latest, see below

## Usage

### Run once

`npx -y jelmerro/nus`

### Add to scripts

```json
{
    "scripts": {
        "update": "npx -y jelmerro/nus"
    }
}
```

Then simply run `npm run update` to update everything.
In short, this will find the current versions for each package in the `package.json`,
then change the versions in this file, delete various lock files and `node_modules`,
finally install the packages from scratch based on the updated `package.json` file.
The overrides are the main way to change package versions using nus if needed,
so see below for all information about configuring it using the config file.

### Ask mode

With the interactive ask mode you can have nus ask which version of a package to install.
A version selector will be shown to select the version by typing and/or arrow keys.
Enter selects the version, while Ctrl-C aborts updating entirely without changes.
By default this is off, but you can turn it on either via the config below,
or via the CLI with `--ask` or `--ask=<val>`, where `<val>` chooses which packages to ask.
Without a value, the value will be set to "all", which will ask all packages.
For example, using `--ask=changed` you will only be asked for packages actually updating.
For all possible CLI arguments and different ask values, please see `--help` or below.

## Contribute

You can support my work on [ko-fi](https://ko-fi.com/Jelmerro) or [Github sponsors](https://github.com/sponsors/Jelmerro).
Another way to help is to report issues or suggest new features.
Please try to follow the linter styling when developing, see `npm run lint`.
For an example vimrc that can auto-format based on the included linters,
you can check out my personal [vimrc](https://github.com/Jelmerro/vimrc).

## Output

The nus CLI output is intended to be compact and to the point.
The legend of the output can be summarized as follows:

- Each dependency takes up one line that includes the name and current/old version
- For updated packages, the old and new version are listed separated by `>`
    - The line will be prefixed with `> ` instead of just spaces so it can be easily spotted
- For overridden packages, the override policy is prefixed by `@`
    - The policy and latest version are both listed if conflicting, latest prefixed by `~`
    - The line will be prefixed with `~ ` too if the package was not updated due to the policy
- For too new packages, blocked by the minAge option, a `!` is used as the prefix
- For git, url or file packages which are not transparent about changes a neutral `- ` is prefixed
- Any errors are prefixed with `X `, this can be network or config errors

In short, only the lines that do not start with merely spaces are of interest (because of changes).

## Config

There is an `nus.config.js` that you can store inside the root of your repo.
This file can hold all nus config and even overrides for versions to use.
A full config file (using all default settings) can look like this:

`nus.config.js`

```js
export default {
    "ask": "none",
    "audit": true,
    "cli": {
        "force": false,
        "foregroundScripts": true,
        "fundHide": true,
        "global": false,
        "ignoreScripts": false,
        "legacy": false,
        "loglevel": "notice"
    },
    "dedupe": true,
    "deps": {
        "dev": true,
        "optional": false,
        "peer": false,
        "prod": true
    },
    "install": true,
    "minAge": 0,
    "overrides": {},
    "tool": "npm
}
```

Of course you only have to set the values for things that you actually want to change.

### Tool & CLI

The optional cli subkey is used for giving the respective options to npm, pnpm or bun commands.
For example, `legacy` will set `--legacy-peer-deps` for npm and `--strict-peer-dependencies=false` for pnpm.
Npm's fund messages are by default hidden, while install scripts that run are made visible.
The current supported values for `tool` are: "npm", "npx pnpm", "pnpm", "npx bun" or "bun".
Since lock files are deleted during updates, nus is also convenient for switching between tools.
For most CLI flags, you can use an `.npmrc`, which is also read by pnpm and bun,
unless you only want to set it for running the updates and not by default.

### Audit & Dedupe & Install

The npm/pnpm subcommand that is first run is `install`,
but by default `audit fix` and `dedupe` are also run to keep the output secure and small.
You can control/disable this with the toplevel `audit`, `dedupe` and `install` options.
If `install` is disabled, `audit` and `dedupe` are ignored and no installation is performed.
Old `node_modules` and lock files are always completely cleared regardless of these options.
For `audit` and `install` you can also change it to `"prod"` to only install or audit those.
Unlike npm's default behavior, if you only install production dependencies,
nus will not magically install them when running the audit, but only audit `"prod"`.
Hence setting `install` to `"prod"` will prevent you from auditing dev dependencies,
similar to how setting `install` to `false` will abort early and not run install nor audit.

### Deps

With the keys in this object you can control which type of dependencies should be updated.
By default, only dev and regular/prod dependencies are updated, but peer and optional are also supported.
This specifically changes which should be updated, you can change which are installed with `install` as per above.

### MinAge

This controls the minimal age that packages should have to be considered.
As such, this options works exactly like [pnpm's minimumReleaseAge option](https://pnpm.io/settings#minimumreleaseage).
It is recommended to keep the value of these options in sync, both are defined in minutes.
In case all more recent versions of a package are too new for the minAge,
an error is shown and the current version will remain in place without change.
If there is an in-between version that is newer but still old enough, it will be updated to.

### Ask

This option enables the interactive ask mode for some or all packages.
A version selector will be shown for each packages that this value enables it for.
By default none, but you can enable it for the following group of packages:
- "all" will show the selector for each and every package, including already up to date ones
- "blocked" for packages that can't be updated at all due to overrides or minAge
- "semi" for packages that can be updated but not to latest because of that
- "latest" for packages that will be updated to latest but were not before
You can choose to mix these into broader selectors via these:
- "nonlatest" for both blocked and semi packages
- "changed" for both semi and to be updated to latest packages

### Overrides

Inside the `nus.config.js` file you can specify a string-string object of versions.
This object is used to change specific packages from using a different version than latest.
This can be done by listing an exact version, a dist-tag or a semver range.
For example, to use the latest beta tag of package `package-a`,
as well as the newest v5.x.x major release of `package-b` (but not 6.0.0 or newer):

```js
export default {
    "overrides": {
        "package-a": "beta",
        "package-b": "^5"
    }
}
```

You can also list versions directly, but tags and [semver ranges](https://github.com/npm/node-semver#ranges) are recommended.
Direct source urls (such as those starting with `http:`/`https:`) or file dependencies are always skipped.
Aliased packages, such as `"custom-package": "npm:package@version"`, are by default updated to latest,
even if `package` is overridden, but can be overridden separately by using the `custom-package` name instead.

#### Git overrides

In case of git(hub) packages, you can supply a commit-ish argument,
which means any tag, sha hash, or branch which can be supplied as an argument to `git checkout`.
For example, `#1.0.0`, `#c1f134d` or `#master` are all valid, the `#` is optional in the nus config,
but you might want to list it with the `#` to be explicit about git package overrides.
Unlike npm semver ranges and versions, these are not checked for validity before installing,
so unlike invalid semver ranges, supplying an invalid git override will prevent `npm install` from working.
