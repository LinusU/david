#!/usr/bin/env node

var optimist = require("optimist")
  .usage(
    "Get latest dependency version information.\n" +
    "Usage: $0 [command] [options...] [dependency names...]\n\n" +
    "Command:\n" +
    "  update, u  Update dependencies to latest STABLE versions and save to package.json"
  )
  .alias("g", "global")
  .describe("g", "Consider global dependencies")
  .alias("u", "unstable")
  .describe("u", "Use UNSTABLE dependencies")
  .alias("v", "version")
  .describe("v", "Print version number and exit")
  .alias("r", "registry")
  .describe("r", "The npm registry URL")
  .describe("warn404", "If dependency not found, continue and warn")
  .default("r", "https://registry.npmjs.org/")

var david = require("../")
  , argv = optimist.argv
  , fs = require("fs")
  , npm = require("npm")
  , cwd = process.cwd()
  , packageFile = cwd + "/package.json"

var blue  = "\033[34m"
  , reset = "\033[0m"
  , green = "\033[32m"
  , gray = "\033[90m"
  , yellow = "\033[33m"
  , red = "\033[31m"

if (argv.usage || argv.help || argv.h) {
  return optimist.showHelp()
}

if (argv.version) {
  return console.log("v" + require("../package.json").version)
}

argv.update = argv._.indexOf("update") > -1 || argv._.indexOf("u") > -1

/**
 * Like printDeps(), walk the list. But only print dependencies
 * with warnings.
 * @param {Object} deps
 * @param {String} type
 */
function printWarnings (deps, type) {
  if (!Object.keys(deps).length) {
    return
  }

  type = type ? type.trim() + " " : ""

  var warnings = { E404: { title: "Unregistered", list: [] } }

  for (var name in deps) {
    var dep = deps[name];

    if (dep.warn) {
      warnings[dep.warn.code].list.push(gray + name + " (" + red + dep.warn.msg + reset + ")")
    }
  }

  Object.keys(warnings).forEach(function (warnType) {
    var warnList = warnings[warnType].list

    if (warnList.length) {
      console.log("")
      console.log("%s%s %sDependencies%s", yellow, warnings[warnType].title, type, reset)
      console.log("")
      warnList.forEach(function (msg) {
        console.log(msg);
      })
      console.log("")
    }
  })
}

function printDeps (deps, type) {
  if (!Object.keys(deps).length) {
    return
  }

  type = type ? type + " " : ""

  var oneLine = ["npm install"]

  if (type === "Dev ") {
    oneLine.push("--save-dev")
  } else if (type === "Optional ") {
    oneLine.push("--save-optional")
  } else if (type === "Global ") {
    oneLine.push("--global")
  } else {
    oneLine.push("--save")
  }

  console.log("")
  console.log("%sOutdated %sDependencies%s", yellow, type, reset)
  console.log("")

  for (var name in deps) {
    var dep = deps[name]

    if (dep.warn) {
      continue
    }

    oneLine.push(name+"@"+dep[argv.unstable ? "latest" : "stable"])
    console.log("%s%s%s %s(package:%s %s, %slatest: %s%s%s)%s",
                green,
                name,
                reset,

                gray,
                blue,
                dep.required,

                gray,
                blue,
                dep[argv.unstable ? "latest" : "stable"],
                gray,
                reset
               )
  }
  console.log("")
  console.log("%s%s%s", gray, oneLine.join(" "), reset)
  console.log("")

  printWarnings(deps, type)
}

// Log feedback if all dependencies are up to date
function printAllUpToDate (deps, devDeps, optionalDeps) {
  if (!Object.keys(deps).length && !Object.keys(devDeps).length && !Object.keys(optionalDeps).length) {
    console.log("%sAll dependencies up to date%s", green, reset)
  }
}

// Get a list of dependency filters
var filterList = argv._.filter(function (v) {
  return !(v === "update" || v === "u")
})

// Filter the passed deps (result from david) by the dependency names passed on the command line
function filterDeps (deps) {
  if (!filterList.length) return deps

  return Object.keys(deps).reduce(function (filteredDeps, name) {
    if (filterList.indexOf(name) !== -1) {
      filteredDeps[name] = deps[name]
    }
    return filteredDeps
  }, {})
}

// Get updated deps, devDeps and optionalDeps
function getDeps (pkg, cb) {
  david.getUpdatedDependencies(pkg, { npm: { registry: argv.registry }, stable: !argv.unstable, loose: true, warn: { E404: argv.warn404 } }, function (er, deps) {
    if (er) return cb(er)

    david.getUpdatedDependencies(pkg, { npm: { registry: argv.registry }, dev: true, stable: !argv.unstable, loose: true, warn: { E404: argv.warn404 } }, function (er, devDeps) {
      if (er) return cb(er)

      david.getUpdatedDependencies(pkg, { npm: { registry: argv.registry }, optional: true, stable: !argv.unstable, loose: true, warn: { E404: argv.warn404 } }, function (er, optionalDeps) {
        cb(er, filterDeps(deps), filterDeps(devDeps), filterDeps(optionalDeps))
      })
    })
  })
}

/**
 * Install the passed dependencies
 *
 * @param {Object} deps Dependencies to install (result from david)
 * @param {Object} opts Install options
 * @param {Boolean} [opts.global] Install globally
 * @param {Boolean} [opts.save] Save installed dependencies to dependencies/devDependencies/optionalDependencies
 * @param {Boolean} [opts.dev] Provided dependencies are dev dependencies
 * @param {Boolean} [opts.optional] Provided dependencies are optional dependencies
 * @param {String} [opts.registry] The npm registry URL to use
 * @param {Function} cb Callback
 */
function installDeps (deps, opts, cb) {
  opts = opts || {}

  var depNames = Object.keys(deps)

  // Nothing to install!
  if (!depNames.length) {
    return cb(null)
  }

  depNames = depNames.filter(function (depName) {
    return !deps[depName].warn
  })

  npm.load({
    registry: opts.registry,
    global: opts.global
  }, function (er) {
    if (er) return cb(er)

    if (opts.save) {
      npm.config.set("save" + (opts.dev ? "-dev" : opts.optional ? "-optional" : ""), true)
    }

    var installArgs = depNames.map(function (depName) {
      return depName + "@" + deps[depName][argv.unstable ? "latest" : "stable"]
    })

    npm.commands.install(installArgs, function (er) {
      npm.config.set("save" + (opts.dev ? "-dev" : opts.optional ? "-optional" : ""), false)
      cb(er)
    })
  })
}

if (argv.global) {

  npm.load({ registry: argv.registry, global: true }, function(err) {
    if (err) throw err

    npm.commands.ls([], true, function(err, data) {
      if (err) throw err

      var pkg = {
        name: "Global Dependencies",
        dependencies: {}
      }

      for (var key in data.dependencies) {
        pkg.dependencies[key] = data.dependencies[key].version
      }

      getDeps(pkg, function (er, deps) {
        if (er) return console.error("Failed to get updated dependencies/devDependencies", er)

        if (argv.update) {

          installDeps(deps, { registry: argv.registry, global: true}, function (er) {
            if (er) return console.error("Failed to update global dependencies", er)

            printWarnings(deps, "Global")
          })

        } else {
          printDeps(deps, "Global")
        }
      })
    })
  })

} else {

  if (!fs.existsSync(packageFile)) {
    return console.error("package.json does not exist")
  }

  var pkg = require(cwd + "/package.json")

  getDeps(pkg, function (er, deps, devDeps, optionalDeps) {
    if (er) return console.error("Failed to get updated dependencies/devDependencies", er)

    if (argv.update) {

      installDeps(deps, {registry: argv.registry, save: true}, function (er) {
        if (er) return console.error("Failed to update/save dependencies", er)

        installDeps(devDeps, {registry: argv.registry, save: true, dev: true}, function (er) {
          if (er) return console.error("Failed to update/save devDependencies", er)

          installDeps(optionalDeps, {registry: argv.registry, save: true, optional: true}, function (er) {
            if (er) return console.error("Failed to update/save optionalDependencies", er)

            printWarnings(deps)
            printWarnings(devDeps, "Dev")
            printWarnings(optionalDeps, "Optional")
          })
        })
      })

    } else {
      printDeps(deps)
      printDeps(devDeps, "Dev")
      printDeps(optionalDeps, "Optional")
    }
    printAllUpToDate(deps, devDeps, optionalDeps)
  })
}
