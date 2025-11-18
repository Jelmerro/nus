nus
===

Node/npm Update Script - A script to update all node/npm packages in a project.

## Features

- Always update to the latest including major (unless overridden using [semver ranges](https://github.com/npm/node-semver))
- Always do a clean install to update nested dependencies too
- Specify custom versions to use by tag, range or version (default is latest)
- Single command to update, install, audit and finally dedupe
- Custom save-prefix, npm install options (force/legacy-peer-deps) or use pnpm
- Exact versions in package.json to avoid confusion and surprises
- Clean CLI output: name, old version, new version & update policy (in brackets)

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
then change the versions in this file, delete `package-lock.json` and `node_modules`,
finally install the packages from scratch based on the updated `package.json` file.
The overrides are the main way to change package versions using nus if needed,
so see below for all information about configuring it using the config file.

## Contribute

You can support my work on [ko-fi](https://ko-fi.com/Jelmerro) or [Github sponsors](https://github.com/sponsors/Jelmerro).
Another way to help is to report issues or suggest new features.
Please try to follow the linter styling when developing, see `npm run lint`.
For an example vimrc that can auto-format based on the included linters,
you can check out my personal [vimrc](https://github.com/Jelmerro/vimrc).

### Output

The nus CLI output is intended to be compact and to the point.
The legend of the output can be summarized as follows:

- Each dependency takes up one line that includes the name and current version
- For updated packages, the old and new version are listed separated by `>`
    - The line will be prefixed with `> ` instead of just spaces so it can be easily spotted
- For overridden packages, the override policy is listed between brackets
    - The policy and latest version are both listed separated by `~` if conflicting
    - The line will be prefixed with `~ ` too if the package was not updated due to the policy
- For git, url or file packages which are not transparent about changes a `- ` is prefixed
- Any errors are prefixed with `X `, this can be network or config errors

In short, only the lines that do not start with merely spaces are of interest (because of changes).

## Config

There is an `nus.config.js` that you can store inside the root of your repo.
This file can hold all nus config and even overrides for versions to use.
A basic config (using all default settings) can look like this:

`nus.config.js`

```js
export default {
    "audit": true,
    "dedupe": true,
    "cli": {
        "force": false,
        "foregroundScripts": true,
        "fundHide": true,
        "global": false,
        "ignoreScripts": false,
        "legacy": false,
        "silent": false,
        "verbose": false
    },
    "overrides": {},
    "prefixChar": "",
    "tool": "npm
}
```

### Tool & CLI

The optional cli subkey is used for giving the respective options to npm or pnpm commands,
you can control which of these should be used with the `tool` config key.
The current supported values for `tool` are: "npm", "npx pnpm" and "pnpm".
For example, `legacy` will set `--legacy-peer-deps` for npm and `--strict-peer-dependencies=false` for pnpm.
Npm's fund messages are by default hidden, while install scripts that run are made visible.

### Audit & Dedupe

The npm/pnpm subcommand that is always run is `install`,
but by default `audit fix` and `dedupe` are also run to keep the output secure and small.
You can control/disable this with the toplevel `audit` and `dedupe` options.

### PrefixChar

You can also change the prefixChar option to add a char in front of versions,
such as "~" for only patch upgrades and "^" for any non-major ones.
This character is added only to the package.json, mostly as a suggestion,
as you should rarely if ever run a plain `npm i` instead of `npm ci`,
hence why by default it is left empty to specify the exact version.

### Overrides

Inside the `nus.config.js` file you can specify a string-string object of versions.
This object is used to change specific packages from using a different version than latest.
This can be done by listing an exact version, a dist-tag or a semver range.
For example, to use the latest beta tag of package `package-a`,
as well as the newest v5.x.x major release of `package-b` (but not 6.0.0 or newer),
you should use an overrides section like so:

```json
{
    "package-a": "beta",
    "package-b": "^5"
}
```

You can also list versions directly, but tags and [semver ranges](https://github.com/npm/node-semver#ranges) are recommended.
If you only want to change the overrides and not any config,
you can also use `nus.overrides.json` in the root of your project.
This file does not support any other config, but just the overrides object like above.
You are free to have both a config and an overrides file,
but if you have the same package name in both files the overrides file has priority.
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
