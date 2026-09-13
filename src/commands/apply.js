const fs = require("node:fs");
const path = require("node:path");
const { appendAudit } = require("../core/audit");
const { runApply, validateApplyRequest } = require("../core/apply-engine");
const { loadConfig } = require("../core/config");
const { createPaths } = require("../core/paths");
const { loadRunState, saveRunState, transitionState } = require("../core/state");

function parseArguments(argv) {
  if (!Array.isArray(argv)) throw new Error("apply arguments must be an array");
  let mode;
  let approvalHash;
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--mode", "--approve"].includes(option)) throw new Error("Usage: apply --mode <pilot|resume> --approve <plan-hash>");
    if (option === "--mode") {
      if (mode !== undefined) throw new Error("Duplicate --mode");
      mode = value;
    } else {
      if (approvalHash !== undefined) throw new Error("Duplicate --approve");
      approvalHash = value;
    }
  }
  if (!mode || !approvalHash) throw new Error("Both --mode and --approve are required");
  if (!/^[a-f0-9]{64}$/.test(approvalHash)) throw new Error("Approval hash must be 64 lowercase hexadecimal characters");
  if (!["pilot", "resume"].includes(mode)) throw new Error("Apply mode must be pilot or resume");
  return { mode, approvalHash };
}

function readJson(target, label) {
  let text;
  try { text = fs.readFileSync(target, "utf8"); }
  catch (error) { throw new Error(`Unable to read ${label}: ${error.message}`); }
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`Malformed ${label}: ${error.message}`); }
}

function effectiveConfig(rootDir, deps) {
  if (deps.config) return deps.config;
  const configured = deps.configPath || path.join(rootDir, "config", "organizer.yaml");
  const example = path.join(rootDir, "config", "organizer.example.yaml");
  const target = fs.existsSync(configured) ? configured : example;
  return (deps.loadConfig || loadConfig)(target);
}

function requireVerifiedPilot(state, planHash) {
  if (state.pilotVerification?.status !== "verified" || state.pilotVerification.planHash !== planHash) {
    throw new Error("Pilot verification for this plan is required before full apply");
  }
}

async function run(argv = [], deps = {}) {
  const { mode, approvalHash } = parseArguments(argv);
  const rootDir = path.resolve(deps.rootDir || process.cwd());
  const paths = deps.paths || createPaths(rootDir);
  const approvedPlan = readJson(path.join(paths.plans, "migration-plan.json"), "migration plan");
  const state = loadRunState(paths);
  const config = effectiveConfig(rootDir, deps);
  const prePhase = mode === "pilot" ? "PLAN_REVIEW" : "APPLY_APPROVAL";
  validateApplyRequest({ plan: approvedPlan, state, approvalHash, config, mode, phases: [prePhase] });
  if (mode === "resume") requireVerifiedPilot(state, approvedPlan.planHash);

  const persist = deps.saveState || saveRunState;
  let adapter;
  try {
    if (deps.createAdapter) adapter = await deps.createAdapter({ paths });
    else if (deps.adapter) adapter = deps.adapter;
    else {
      const { ChatGPTAdapter } = require("../providers/chatgpt/adapter");
      adapter = new ChatGPTAdapter({ paths, chromeExecutable: deps.chromeExecutable });
    }
    const actualFingerprint = await adapter.getAccountFingerprint();
    if (actualFingerprint !== state.accountFingerprint) throw new Error("Account fingerprint mismatch; zero actions performed");

    state.approvals ||= {};
    state.planHash = approvedPlan.planHash;
    if (mode === "pilot") {
      state.approvals.pilot = { planHash: approvalHash };
      transitionState(state, "PILOT_APPROVAL");
      persist(paths, state);
      transitionState(state, "PILOT");
      persist(paths, state);
    } else {
      state.approvals.full = { planHash: approvalHash };
      transitionState(state, "APPLY");
      persist(paths, state);
    }

    const result = await runApply({
      plan: approvedPlan,
      state,
      adapter,
      approvalHash,
      config,
      mode,
      maxActions: deps.maxActions ?? Infinity,
      paths,
      saveState: persist,
      appendAudit: (event) => deps.appendAudit ? deps.appendAudit(paths, event) : appendAudit(paths, event),
    });
    (deps.stdout || process.stdout).write(`${JSON.stringify(result)}\n`);
    return result.stoppedReason ? 1 : 0;
  } finally {
    if (adapter && typeof adapter.close === "function") await adapter.close();
  }
}

module.exports = { run, parseArguments };
