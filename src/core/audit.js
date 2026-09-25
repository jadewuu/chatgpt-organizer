const fs = require("node:fs");
const path = require("node:path");

const allowedFields = new Set([
  "type", "runId", "actionKey", "conversationId", "projectName", "action", "status", "mode", "stoppedReason",
]);
const allowedValues = {
  action: new Set(["createProject", "move", "archive", "keep"]),
  status: new Set(["running", "done", "skipped", "uncertain", "verified", "failed"]),
  mode: new Set(["pilot", "resume", "verify"]),
  stoppedReason: new Set([
    "rate_limited", "access_restricted", "selector_missing", "uncertain", "account_mismatch", "browser_interrupted",
  ]),
};

function isInside(parent, candidate) {
  return candidate !== parent && candidate.startsWith(`${parent}${path.sep}`);
}

function requirePrivateDirectory(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const stats = fs.lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Refusing symlinked or non-directory audit path: ${directory}`);
  }
  fs.chmodSync(directory, 0o700);
}

function safeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Audit event must be an object");
  }
  const output = { timestamp: new Date().toISOString(), provider: "chatgpt" };
  for (const [key, value] of Object.entries(event)) {
    if (allowedFields.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      if (allowedValues[key] && !allowedValues[key].has(value)) continue;
      output[key] = value;
    }
  }
  const previous = event.previousLocation;
  if (["unknown", "unassigned", "absent"].includes(previous?.kind)) output.previousLocation = { kind: previous.kind };
  else if (previous?.kind === "project" && typeof previous.id === "string" && previous.id.length <= 1024) {
    output.previousLocation = { kind: "project", id: previous.id };
  }
  const evidence = event.verificationEvidence;
  if (["not_checked", "conversation_location", "project_inventory"].includes(evidence?.method)
    && ["pending", "verified", "uncertain", "rate_limited", "access_restricted", "selector_missing", "browser_interrupted"].includes(evidence?.status)) {
    output.verificationEvidence = { method: evidence.method, status: evidence.status };
  }
  if (typeof output.type !== "string" || !output.type) throw new Error("Audit event type is required");
  return output;
}

function forensicContext(action, status = "pending") {
  return {
    timestamp: new Date().toISOString(),
    provider: "chatgpt",
    previousLocation: action.kind === "project" ? { kind: "absent" }
      : typeof action.currentProject === "string" ? { kind: "project", id: action.currentProject }
        : action.currentProject === null ? { kind: "unassigned" } : { kind: "unknown" },
    verificationEvidence: {
      method: status === "pending" ? "not_checked" : action.kind === "project" ? "project_inventory" : "conversation_location",
      status,
    },
  };
}

function appendAudit(paths, event) {
  if (!paths || typeof paths.local !== "string" || typeof paths.audit !== "string") {
    throw new Error("Private audit paths are required");
  }
  const local = path.resolve(paths.local);
  const audit = path.resolve(paths.audit);
  if (!isInside(local, audit)) throw new Error("Refusing audit path outside .local");

  requirePrivateDirectory(local);
  const resolvedLocal = fs.realpathSync(local);
  requirePrivateDirectory(audit);
  const resolvedAudit = fs.realpathSync(audit);
  if (!isInside(resolvedLocal, resolvedAudit)) throw new Error("Refusing resolved audit path outside .local");

  const target = path.join(audit, "events.jsonl");
  if (fs.existsSync(target)) {
    const targetStats = fs.lstatSync(target);
    if (targetStats.isSymbolicLink() || !targetStats.isFile()) {
      throw new Error("Refusing symlinked or non-file audit log");
    }
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(target, flags, 0o600);
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("Refusing non-file audit log");
    fs.fchmodSync(descriptor, 0o600);
    fs.writeSync(descriptor, `${JSON.stringify(safeEvent(event))}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = { appendAudit, forensicContext };
