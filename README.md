nus
===

Node/npm Update Script - A script to update all node/npm packages in a project.

## Features

- Always update to the latest including major (unless overridden using [semver ranges](https://github.com/npm/node-semver))
- Always do a clean install to update nested dependencies too
- Specify custom versions to use by tag, range or version (default is latest)
- Single command to update, install, audit and finally dedup
- Custom save-prefix, npm install options (force/legacy-peer-deps) and indent
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
In short, this will find the right versions for each package in the `package.json`,
then change the versions in this file, delete `package-lock.json` and `node_modules`,
finally install the packages from scratch based on the updated `package.json` file.
The overrides are the main way to change package versions using nus if needed,
so see below for all information about configuring it using the config file.

## Config

There is an `nus.config.js` that you can store inside the root of your repo.
This file can hold all nus config and even overrides for versions to use.
A basic config (using all default settings) can look like this:

`nus.config.js`

```js
export default {
    "audit": true,
    "dedup": true,
    "indent": 4,
    "npm": {
        "force": false,
        "global": false,
        "ignoreScripts": false,
        "legacy": false,
        "silent": false,
        "verbose": false
    },
    "overrides": {},
    "prefixChar": ""
}
```

The audit and dedup options are for running respective npm commands after `npm ci`.
The indent option is the indent level in spaces (or literally `"\t"`) for the package.json.
If unset, the package.json's current indent level (or tabs) are checked and re-used,
so in practice you should rarely need to set this explicitly.
The same is true for and boolean options that are already set to the value you need.
The npm subkey is used for giving the respective options to npm commands,
the one that is always run is `npm ci`, but by default `audit` and `dedup` are also run.
They all use the same npm arguments, by default none, to install/audit/dedup the packages.
You can also change the prefixChar option to add a char in front of versions,
such as "~" for only patch upgrades and "^" for any non-major ones.
This character is added only to the package.json, mostly as a suggestion,
as you should rarely if ever run a plain `npm i` instead of `npm ci`,
hence why by default it is left empty to specify the exact version.
CommonJS's `module.exports` syntax will also work if you have not set `"type": "module"` yet.

### Overrides

Inside the `nus.config.js` file you can specify a string-string object of versions.
This object is used to change specific packages from using a different version than latest.
This can be done by listing an exact version, a dist-tag or a semver range.
For example, to use the latest beta tag of package `package-a`,
as well as the newest v5.x.x major release of `package-b` (but not 6.0.0 or newer),
you should use and overrides section like so:

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

## License

nus was ported from an old python script I always copied and used to update with.
I have licensed the original script under various licenses, either GPL3 or MIT.
Since the current JS iteration is a complete rewrite, I decided to go plain MIT.
You can see the LICENSE file for exact terms and conditions.
