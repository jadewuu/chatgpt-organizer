const path = require("node:path");
const crypto = require("node:crypto");
const { createPaths } = require("../core/paths");
const { createRunState, loadRunState, saveRunState, transitionState } = require("../core/state");
const { ChatGPTAdapter } = require("../providers/chatgpt/adapter");

function persistDiscoveryState(paths, accountFingerprint, workspaceFingerprint, randomUUID = crypto.randomUUID) {
  if (typeof accountFingerprint !== "string" || !accountFingerprint) throw new Error("Stable account context unavailable; stopped");
  if (typeof workspaceFingerprint !== "string" || !workspaceFingerprint) throw new Error("Stable workspace context unavailable; stopped");
  const existing = loadRunState(paths);
  if (!existing) {
    const state = createRunState(randomUUID(), accountFingerprint, workspaceFingerprint);
    transitionState(state, "AUTHENTICATE");
    transitionState(state, "DISCOVER");
    return saveRunState(paths, state);
  }
  if (existing.accountFingerprint !== accountFingerprint) throw new Error("Account mismatch; stopped");
  if (existing.workspaceFingerprint && existing.workspaceFingerprint !== workspaceFingerprint) throw new Error("Workspace mismatch; stopped");
  existing.workspaceFingerprint = workspaceFingerprint;
  if (existing.phase === "PREFLIGHT") transitionState(existing, "AUTHENTICATE");
  if (existing.phase === "AUTHENTICATE") transitionState(existing, "DISCOVER");
  if (!["DISCOVER", "TAXONOMY_REVIEW", "CLASSIFY", "PLAN_REVIEW", "PILOT_APPROVAL", "PILOT", "APPLY_APPROVAL", "APPLY", "VERIFY", "COMPLETE"].includes(existing.phase)) {
    throw new Error("Invalid persisted run state phase");
  }
  return saveRunState(paths, existing);
}

async function run(argv = [], deps = {}) {
  let max = Infinity;
  if (argv.length) {
    if (argv.length !== 2 || argv[0] !== "--max" || !/^[1-9]\d*$/.test(argv[1]) || !Number.isSafeInteger(Number(argv[1]))) {
      throw new Error("Usage: discover [--max <positive integer>]");
    }
    max = Number(argv[1]);
  }
  const adapter = deps.adapter || new ChatGPTAdapter({ paths: deps.paths || createPaths(deps.rootDir), chromeExecutable: deps.chromeExecutable });
  try {
    const projects = await adapter.listProjects();
    const records = await adapter.discoverConversations({ max });
    const accountFingerprint = await adapter.getAccountFingerprint();
    const workspaceFingerprint = adapter.workspaceFingerprint;
    adapter.writeJson(path.join(adapter.paths.raw, "projects.json"), projects);
    persistDiscoveryState(adapter.paths, accountFingerprint, workspaceFingerprint, deps.randomUUID);
    (deps.stdout || process.stdout).write(`Discovered ${records.length} conversations in .local/raw/conversations.json\n`);
    (deps.stdout || process.stdout).write(`Observed ${projects.length} Projects in .local/raw/projects.json\n`);
    return 0;
  } finally { await adapter.close(); }
}

module.exports = { run, persistDiscoveryState };
