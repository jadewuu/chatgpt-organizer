const fs = require("node:fs");
const path = require("node:path");
const { createPaths } = require("../core/paths");
const { loadConfig: defaultLoadConfig } = require("../core/config");
const { validateTaxonomy: defaultValidateTaxonomy } = require("../core/validate");

const privatePathNames = ["profile", "state", "raw", "plans", "reports", "audit", "logs"];
const legacyIgnorePatterns = [".local/", "data/", "profile/", "chrome-profile/", "logs/"];
const defaultChromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function check(name, status, message) {
  return { name, status, message };
}

function statusFromBoolean(value, okMessage, failMessage) {
  return value ? ["ok", okMessage] : ["fail", failMessage];
}

function nodeCheck(nodeVersion) {
  const major = Number.parseInt(String(nodeVersion).replace(/^v/, "").split(".")[0], 10);
  if (!Number.isFinite(major)) return check("node", "fail", `Unable to parse Node.js version ${nodeVersion}`);
  if (major < 20) return check("node", "fail", `Node.js ${nodeVersion} is too old; require major version 20 or newer`);
  return check("node", "ok", `Node.js ${nodeVersion}`);
}

function platformCheck(platform) {
  if (platform === "darwin") return check("platform", "ok", "macOS is supported");
  return check("platform", "warn", `${platform} is not the supported macOS runtime`);
}

function chromeCheck(deps, platform) {
  const executable = deps.chromeExecutable
    || process.env.ORGANIZER_CHROME_EXECUTABLE
    || (platform === "darwin" ? defaultChromeExecutable : "google-chrome");
  const exists = typeof deps.chromeExists === "boolean" ? deps.chromeExists : isExecutableFile(executable);
  const [status, message] = statusFromBoolean(
    exists,
    `Chrome executable found at ${executable}`,
    `Chrome executable not found at ${executable}`,
  );
  return check("chrome", status, message);
}

function isExecutableFile(target) {
  try {
    if (!fs.statSync(target).isFile()) return false;
    fs.accessSync(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathsCheck(paths) {
  if (!paths || typeof paths.local !== "string") return check("paths", "fail", "Unable to determine .local paths");
  const local = path.resolve(paths.local);
  const outside = privatePathNames.find((name) => {
    if (typeof paths[name] !== "string") return true;
    const target = path.resolve(paths[name]);
    return target !== local && !target.startsWith(`${local}${path.sep}`);
  });
  if (outside) return check("paths", "fail", `${outside} is outside .local`);
  return check("paths", "ok", `Private paths are contained by ${local}`);
}

function hasIgnoreCoverage(rootDir) {
  const ignorePath = path.join(rootDir, ".gitignore");
  try {
    const lines = fs.readFileSync(ignorePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\//, ""))
      .filter((line) => line && !line.startsWith("#"));
    return legacyIgnorePatterns.every((pattern) => lines.includes(pattern) || lines.includes(pattern.slice(0, -1)));
  } catch {
    return false;
  }
}

function ignoreCheck(deps, rootDir) {
  if (typeof deps.privatePathsIgnored === "boolean") {
    const [status, message] = statusFromBoolean(
      deps.privatePathsIgnored,
      "Private and legacy data paths are covered by ignore rules",
      "Private data paths are not covered by ignore rules",
    );
    return check("ignore", status, message);
  }
  const covered = hasIgnoreCoverage(rootDir);
  const [status, message] = statusFromBoolean(
    covered,
    "Private and legacy data paths are covered by .gitignore",
    "Expected private data paths are missing from .gitignore",
  );
  return check("ignore", status, message);
}

function configCheck(deps, rootDir) {
  if (typeof deps.configParseable === "boolean") {
    const [status, message] = statusFromBoolean(
      deps.configParseable,
      "Configuration is parseable",
      "Configuration is not parseable",
    );
    return check("config", status, message);
  }
  const hasExplicitPath = typeof deps.configPath === "string";
  const configuredPath = deps.configPath || path.join(rootDir, "config", "organizer.yaml");
  const examplePath = path.join(rootDir, "config", "organizer.example.yaml");
  const filePath = fs.existsSync(configuredPath)
    ? configuredPath
    : (hasExplicitPath ? null : (fs.existsSync(examplePath) ? examplePath : null));
  if (hasExplicitPath && !filePath) return check("config", "fail", `Configuration file not found: ${configuredPath}`);
  if (!filePath) return check("config", "warn", "No organizer.yaml found; using built-in defaults");
  try {
    const config = (deps.loadConfig || defaultLoadConfig)(filePath);
    if (config.taxonomy !== undefined) (deps.validateTaxonomy || defaultValidateTaxonomy)(config.taxonomy);
    const suffix = filePath === examplePath ? " (example configuration)" : "";
    return check("config", "ok", `Configuration is parseable: ${path.relative(rootDir, filePath)}${suffix}`);
  } catch (error) {
    return check("config", "fail", `Configuration could not be parsed: ${error.message}`);
  }
}

function canWrite(target) {
  if (typeof target !== "string" || target.length === 0) return false;
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    if (!fs.statSync(current).isDirectory()) return false;
    fs.accessSync(current, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function writableCheck(deps, paths) {
  if (typeof deps.writableLocalDirs === "boolean") {
    const [status, message] = statusFromBoolean(
      deps.writableLocalDirs,
      "Private local directories are writable",
      "Private local directories are not writable",
    );
    return check("writable", status, message);
  }
  if (!paths || privatePathNames.some((name) => typeof paths[name] !== "string")) {
    return check("writable", "fail", "Private local paths are incomplete");
  }
  const targets = privatePathNames.map((name) => paths[name]);
  const unwritable = targets.find((target) => !canWrite(target));
  if (unwritable) return check("writable", "fail", `Cannot write to ${unwritable}`);
  return check("writable", "ok", "Private local directories are writable or can be created");
}

function normalizeBrowserChecks(value) {
  if (!Array.isArray(value)) return [check("browser", "fail", "Browser check did not return checks")];
  return value.map((item) => {
    if (!item || typeof item.name !== "string" || !["ok", "warn", "fail"].includes(item.status)) {
      return check("browser", "fail", "Browser check returned an invalid check");
    }
    return { name: item.name, status: item.status, message: String(item.message || "") };
  });
}

/**
 * Run read-only environment checks. Browser checks are only called when
 * `deps.browser` is true; this function never launches a browser itself.
 */
async function runDoctor(deps = {}) {
  const rootDir = path.resolve(deps.rootDir || process.cwd());
  const paths = deps.paths || createPaths(rootDir);
  const platform = deps.platform || process.platform;
  const checks = [
    nodeCheck(deps.nodeVersion || process.versions.node),
    platformCheck(platform),
    chromeCheck(deps, platform),
    pathsCheck(paths),
    ignoreCheck(deps, rootDir),
    configCheck(deps, rootDir),
    writableCheck(deps, paths),
  ];

  if (deps.browser === true) {
    const browserCheck = deps.browserCheck || deps.runBrowserChecks;
    if (typeof browserCheck !== "function") {
      checks.push(check("browser", "warn", "Browser checks require an opt-in browser adapter"));
    } else {
      try {
        checks.push(...normalizeBrowserChecks(await browserCheck(deps)));
      } catch (error) {
        checks.push(check("browser", "fail", `Browser check failed: ${error.message}`));
      }
    }
  }
  return checks;
}

async function run(argv = [], deps = {}) {
  const checkRunner = deps.runDoctor || runDoctor;
  const checks = await checkRunner({ ...deps, browser: argv.includes("--browser") });
  if (typeof checks === "number") return checks;
  if (!Array.isArray(checks)) throw new Error("Doctor must return checks or an exit code");
  const output = deps.stdout || process.stdout;
  for (const item of checks) output.write(`[${item.status.toUpperCase()}] ${item.name}: ${item.message}\n`);
  return checks.some((item) => item.status === "fail") ? 1 : 0;
}

module.exports = { runDoctor, run };
