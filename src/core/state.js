const fs = require("node:fs");
const path = require("node:path");

const transitions = {
  PREFLIGHT: ["AUTHENTICATE"],
  AUTHENTICATE: ["DISCOVER"],
  DISCOVER: ["TAXONOMY_REVIEW"],
  TAXONOMY_REVIEW: ["CLASSIFY"],
  CLASSIFY: ["PLAN_REVIEW"],
  PLAN_REVIEW: ["PILOT_APPROVAL"],
  PILOT_APPROVAL: ["PILOT"],
  PILOT: ["APPLY_APPROVAL"],
  APPLY_APPROVAL: ["APPLY"],
  APPLY: ["VERIFY"],
  VERIFY: ["COMPLETE"],
  COMPLETE: [],
};

function createRunState(runId, accountFingerprint, workspaceFingerprint) {
  return { runId, accountFingerprint, ...(workspaceFingerprint ? { workspaceFingerprint } : {}), phase: "PREFLIGHT" };
}

function validatePersistedAccountContext(paths, state) {
  let account;
  try { account = JSON.parse(fs.readFileSync(path.join(paths.state, "account.json"), "utf8")); }
  catch (error) { throw new Error(`Unable to validate persisted account context: ${error.message}`); }
  const keys = account && typeof account === "object" && !Array.isArray(account) ? Object.keys(account).sort() : [];
  if (keys.join(",") !== "accountFingerprint,workspaceFingerprint"
    || typeof state?.accountFingerprint !== "string" || !state.accountFingerprint
    || typeof state?.workspaceFingerprint !== "string" || !state.workspaceFingerprint
    || account.accountFingerprint !== state.accountFingerprint
    || account.workspaceFingerprint !== state.workspaceFingerprint) {
    throw new Error("Persisted account and workspace context does not match the run state");
  }
  return account;
}

function transitionState(state, next) {
  if (!transitions[state.phase]?.includes(next)) {
    throw new Error(`Invalid transition: ${state.phase} -> ${next}`);
  }
  state.phase = next;
  return state;
}

function runStatePath(paths) {
  return path.join(paths.state, "run.json");
}

function loadRunState(paths) {
  try {
    return JSON.parse(fs.readFileSync(runStatePath(paths), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function saveRunState(paths, state) {
  fs.mkdirSync(paths.state, { recursive: true, mode: 0o700 });
  fs.chmodSync(paths.state, 0o700);
  const target = runStatePath(paths);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
  return state;
}

module.exports = {
  createRunState,
  loadRunState,
  saveRunState,
  transitionState,
  validatePersistedAccountContext,
};
