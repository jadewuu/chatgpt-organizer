const fs = require("node:fs");
const path = require("node:path");
const { appendAudit, forensicContext } = require("../core/audit");
const { actionKey, validateApprovedPlanSemantics } = require("../core/apply-engine");
const { createPaths } = require("../core/paths");
const { hashPlan } = require("../core/planner");
const { loadRunState, saveRunState, transitionState, validatePersistedAccountContext } = require("../core/state");
const { validateMigrationPlan } = require("../core/validate");

const progressStatuses = new Set(["running", "done", "skipped", "uncertain"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function readJson(target, label) {
  let text;
  try { text = fs.readFileSync(target, "utf8"); }
  catch (error) { throw new Error(`Unable to read ${label}: ${error.message}`); }
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`Malformed ${label}: ${error.message}`); }
}

function scheduledActions(plan) {
  const projects = plan.projects.filter((project) => project.createRequired === true).map((project) => ({
    kind: "project", action: "createProject", projectName: project.name, localId: `project:${project.name}`,
  }));
  const conversations = plan.items.map((item) => ({
    kind: "conversation",
    action: item.action,
    conversationId: item.conversationId,
    projectName: item.project,
    currentProject: item.currentProject,
    localId: item.conversationId,
  }));
  return [...projects, ...conversations];
}

function validateStatic(paths) {
  const plan = readJson(path.join(paths.plans, "migration-plan.json"), "migration plan");
  validateMigrationPlan(plan);
  validateApprovedPlanSemantics(plan);
  const calculated = hashPlan(plan);
  if (plan.planHash !== calculated) throw new Error("Migration plan hash does not match its immutable contents");
  const state = loadRunState(paths);
  if (!isPlainObject(state) || typeof state.runId !== "string" || !state.runId
    || typeof state.accountFingerprint !== "string" || !state.accountFingerprint
    || typeof state.workspaceFingerprint !== "string" || !state.workspaceFingerprint
    || !["PILOT", "APPLY", "VERIFY"].includes(state.phase)) {
    throw new Error("Invalid run state or verification phase");
  }
  if (state.planHash !== calculated) throw new Error("Run state plan hash does not match the immutable plan");
  if (state.approvals?.pilot?.planHash !== calculated) throw new Error("Pilot approval does not match the immutable plan");
  if (["APPLY", "VERIFY"].includes(state.phase)) {
    if (state.approvals?.full?.planHash !== calculated) throw new Error("Full approval does not match the immutable plan");
    if (state.pilotVerification?.status !== "verified" || state.pilotVerification.planHash !== calculated) {
      throw new Error("Verified pilot for this plan is required");
    }
  }
  validatePersistedAccountContext(paths, state);
  const progress = state.applyProgress;
  if (!isPlainObject(progress) || Object.keys(progress).some((key) => !["planHash", "entries"].includes(key))
    || progress.planHash !== calculated || !isPlainObject(progress.entries)) {
    throw new Error("Apply progress is malformed or does not match the plan hash");
  }
  const actions = scheduledActions(plan);
  const allowed = new Map(actions.map((action) => [actionKey(action), action]));
  for (const [key, entry] of Object.entries(progress.entries)) {
    const action = allowed.get(key);
    if (!action) throw new Error(`Unknown or orphaned apply progress key: ${key}`);
    if (!isPlainObject(entry) || Object.keys(entry).length !== 1 || !progressStatuses.has(entry.status)) {
      throw new Error(`Invalid apply progress for local item ${action.localId}`);
    }
    if (entry.status === "running" || entry.status === "uncertain") {
      throw new Error(`Local item ${action.localId} requires manual review before verification`);
    }
  }
  const incomplete = [];
  if (state.phase === "PILOT") {
    const completedWrites = actions.filter((action) => action.action !== "keep"
      && progress.entries[actionKey(action)]?.status === "done");
    if (completedWrites.length > 5) throw new Error("Pilot progress exceeds the five-write safety limit");
  }
  if (state.phase !== "PILOT") {
    for (const action of actions) {
      if (action.action === "keep") continue;
      const status = progress.entries[actionKey(action)]?.status;
      if (status !== "done" && status !== "skipped") incomplete.push(action.localId);
    }
  }
  if (state.phase === "VERIFY" && incomplete.length) throw new Error("Final verification has incomplete pending actions");
  return { plan, state, actions, incomplete };
}

function verificationEvent(state, action, status) {
  const event = {
    ...forensicContext(action, status),
    type: "verification",
    runId: state.runId,
    actionKey: actionKey(action),
    action: action.action,
    status,
    mode: "verify",
  };
  if (action.conversationId) event.conversationId = action.conversationId;
  if (action.projectName) event.projectName = action.projectName;
  return event;
}

async function run(argv = [], deps = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) throw new Error("Usage: verify");
  const paths = deps.paths || createPaths(path.resolve(deps.rootDir || process.cwd()));
  const validated = validateStatic(paths);
  const output = deps.stdout || process.stdout;
  let adapter;
  try {
    if (deps.createAdapter) adapter = await deps.createAdapter({ paths });
    else if (deps.adapter) adapter = deps.adapter;
    else {
      const { ChatGPTAdapter } = require("../providers/chatgpt/adapter");
      adapter = new ChatGPTAdapter({ paths, chromeExecutable: deps.chromeExecutable });
    }
    const actualFingerprint = await adapter.getAccountFingerprint({ workspaceFingerprint: validated.state.workspaceFingerprint });
    if (actualFingerprint !== validated.state.accountFingerprint) throw new Error("Account fingerprint mismatch; verification stopped");

    const done = validated.actions.filter((action) => validated.state.applyProgress.entries[actionKey(action)]?.status === "done");
    const projectActions = done.filter((action) => action.kind === "project");
    let observedProjects = [];
    let projectObservationFailed = false;
    if (projectActions.length) {
      try { observedProjects = await adapter.listProjects(); }
      catch { projectObservationFailed = true; }
    }
    const manualReviewIds = [];
    let verified = 0;
    const audit = deps.appendAudit
      ? (event) => deps.appendAudit(paths, event)
      : (event) => appendAudit(paths, event);

    for (const action of done) {
      let result;
      let interrupted = false;
      if (action.action === "keep") continue;
      if (action.kind === "project") {
        const exact = observedProjects.filter((project) => project?.name === action.projectName);
        result = !projectObservationFailed && exact.length === 1 ? { status: "verified" } : { status: "uncertain" };
        interrupted = projectObservationFailed;
      } else {
        const expected = action.action === "archive" ? { kind: "archived" } : { kind: "project", name: action.projectName };
        try { result = await adapter.verifyConversationLocation(action.conversationId, expected); }
        catch { result = { status: "uncertain" }; interrupted = true; }
      }
      const status = result?.status === "verified" ? "verified" : "uncertain";
      await audit(verificationEvent(validated.state, action, status));
      if (status === "verified") verified++;
      else manualReviewIds.push(action.localId);
      if (interrupted || ["rate_limited", "access_restricted", "selector_missing"].includes(result?.status)) {
        for (const remaining of done.slice(done.indexOf(action) + 1)) {
          if (remaining.action !== "keep") manualReviewIds.push(remaining.localId);
        }
        break;
      }
    }

    if (manualReviewIds.length) {
      output.write(`${JSON.stringify({ verified, manualReviewIds, phase: validated.state.phase })}\n`);
      return 1;
    }

    const persist = deps.saveState || saveRunState;
    if (validated.state.phase === "PILOT") {
      validated.state.pilotVerification = { status: "verified", planHash: validated.plan.planHash };
      transitionState(validated.state, "APPLY_APPROVAL");
      persist(paths, validated.state);
    } else if (validated.incomplete.length && validated.state.phase === "APPLY") {
      delete validated.state.approvals.full;
      transitionState(validated.state, "APPLY_APPROVAL");
      persist(paths, validated.state);
    } else {
      if (validated.state.phase === "APPLY") {
        transitionState(validated.state, "VERIFY");
        persist(paths, validated.state);
      }
      transitionState(validated.state, "COMPLETE");
      persist(paths, validated.state);
    }
    output.write(`${JSON.stringify({ verified, manualReviewIds: [], phase: validated.state.phase })}\n`);
    return 0;
  } finally {
    if (adapter && typeof adapter.close === "function") await adapter.close();
  }
}

module.exports = { run, validateStatic };
