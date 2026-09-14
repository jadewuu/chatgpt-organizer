const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { assertInsideLocal, createPaths } = require("../core/paths");
const { loadRunState } = require("../core/state");

const standardTargetNames = ["raw", "plans", "reports", "audit", "logs"];
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const phases = new Set([
  "PREFLIGHT", "AUTHENTICATE", "DISCOVER", "TAXONOMY_REVIEW", "CLASSIFY", "PLAN_REVIEW",
  "PILOT_APPROVAL", "PILOT", "APPLY_APPROVAL", "APPLY", "VERIFY", "COMPLETE",
]);

function parseArguments(argv) {
  if (!Array.isArray(argv)) throw new Error("clean:data arguments must be an array");
  if (argv.length === 0) return { includeProfile: false };
  if (argv.length === 1 && argv[0] === "--include-profile") return { includeProfile: true };
  throw new Error("clean:data accepts only --include-profile");
}

function resolveCleanupTargets(paths, { includeProfile = false } = {}) {
  if (!paths || typeof paths.root !== "string" || typeof paths.local !== "string") {
    throw new Error("Private local paths are required");
  }
  const local = path.resolve(paths.local);
  if (local !== path.join(path.resolve(paths.root), ".local")) {
    throw new Error(`Refusing unexpected .local path: ${local}`);
  }
  try {
    const localStats = fs.lstatSync(local);
    if (localStats.isSymbolicLink()) throw new Error(`Refusing symlinked .local path: ${local}`);
    if (!localStats.isDirectory()) throw new Error(`Refusing non-directory .local path: ${local}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const names = includeProfile ? [...standardTargetNames, "profile"] : standardTargetNames;
  return names.map((name) => {
    if (typeof paths[name] !== "string") throw new Error(`Missing cleanup path: ${name}`);
    const target = assertInsideLocal({ ...paths, local }, paths[name]);
    const expected = path.join(local, name);
    if (target !== expected) throw new Error(`Refusing unexpected cleanup target: ${target}`);
    return target;
  });
}

function cleanData(paths, selections = {}) {
  const targets = resolveCleanupTargets(paths, selections);
  const remove = selections.remove || ((target) => fs.rmSync(target, { recursive: true, force: true }));
  if (typeof remove !== "function") throw new Error("Cleanup removal function must be callable");
  const removed = [];
  for (const target of targets) {
    try {
      remove(target);
      removed.push(target);
    } catch (error) {
      throw new Error(`Failed to remove ${target}: ${error.message}`, { cause: error });
    }
  }
  return removed;
}

function validRunState(paths, loader = loadRunState) {
  let state;
  try { state = loader(paths); }
  catch { throw new Error("A valid persisted run state is required before cleanup"); }
  if (!state || typeof state !== "object" || Array.isArray(state)
    || typeof state.runId !== "string" || !runIdPattern.test(state.runId)
    || typeof state.accountFingerprint !== "string" || !state.accountFingerprint
    || !phases.has(state.phase)) {
    throw new Error("A valid persisted run state is required before cleanup");
  }
  return state;
}

async function defaultConfirmationReader(prompt) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return await input.question(prompt); }
  finally { input.close(); }
}

async function run(argv = [], deps = {}) {
  const options = parseArguments(argv);
  const paths = deps.paths || createPaths(path.resolve(deps.rootDir || process.cwd()));
  const state = validRunState(paths, deps.loadState || loadRunState);
  const targets = resolveCleanupTargets(paths, options);
  const output = deps.stdout || process.stdout;
  const readConfirmation = deps.readConfirmation || defaultConfirmationReader;

  output.write("Cleanup targets (state is preserved):\n");
  for (const target of targets) output.write(`${target}\n`);
  const answer = await readConfirmation(`Type the exact run ID ${state.runId} to remove these local artifacts: `);
  if (answer !== state.runId) {
    output.write("Cleanup cancelled; no files were removed.\n");
    return 1;
  }
  if (options.includeProfile) {
    const profileAnswer = await readConfirmation("Removing the dedicated browser profile will require you to log in again. Type DELETE PROFILE to continue: ");
    if (profileAnswer !== "DELETE PROFILE") {
      output.write("Cleanup cancelled; no files were removed.\n");
      return 1;
    }
  }

  const removed = cleanData(paths, { ...options, remove: deps.remove });
  output.write(`Removed ${removed.length} local artifact paths.\n`);
  return 0;
}

module.exports = { cleanData, parseArguments, resolveCleanupTargets, run };
