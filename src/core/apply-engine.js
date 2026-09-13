const { hashPlan } = require("./planner");
const { saveRunState } = require("./state");
const { validateMigrationPlan } = require("./validate");

const approvalPattern = /^[a-f0-9]{64}$/;
const stopStatuses = new Set(["rate_limited", "access_restricted", "selector_missing", "uncertain"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function actionKey(action) {
  return JSON.stringify(action.kind === "project"
    ? ["project", "create", action.projectName]
    : ["conversation", action.action, action.conversationId]);
}

function actionsFor(plan) {
  const projects = plan.projects
    .filter((project) => project.createRequired === true)
    .map((project) => ({ kind: "project", action: "createProject", projectName: project.name }));
  const conversations = plan.items.map((item) => ({
    kind: "conversation",
    action: item.action,
    conversationId: item.conversationId,
    projectName: item.project,
    planStatus: item.status,
  }));
  return [
    ...projects,
    ...conversations.filter((entry) => entry.action === "move"),
    ...conversations.filter((entry) => entry.action === "archive"),
    ...conversations.filter((entry) => entry.action === "keep"),
  ];
}

function validateState(state, phases) {
  if (!isPlainObject(state) || typeof state.runId !== "string" || !state.runId
    || typeof state.accountFingerprint !== "string" || !state.accountFingerprint
    || !phases.includes(state.phase)) {
    throw new Error(`Invalid run state or phase; expected ${phases.join(" or ")}`);
  }
  if (state.applyProgress !== undefined) {
    if (!isPlainObject(state.applyProgress)) throw new Error("Invalid apply progress");
    for (const progress of Object.values(state.applyProgress)) {
      if (!isPlainObject(progress) || !["running", "done", "skipped", "uncertain"].includes(progress.status)) {
        throw new Error("Invalid apply progress entry");
      }
    }
  }
}

function validateFlags(plan, config) {
  if (!isPlainObject(config) || config.provider !== "chatgpt" || !isPlainObject(config.actions)) {
    throw new Error("Invalid organizer config");
  }
  const requirements = [
    [plan.projects.some((project) => project.createRequired === true), "allowCreateProjects"],
    [plan.items.some((item) => item.action === "move"), "allowMove"],
    [plan.items.some((item) => item.action === "archive"), "allowArchive"],
  ];
  for (const [required, flag] of requirements) {
    if (required && config.actions[flag] !== true) throw new Error(`Action disabled: ${flag} must be exactly true`);
  }
}

function validateApplyRequest({ plan, state, approvalHash, config, mode, phases }) {
  if (!approvalPattern.test(approvalHash || "")) throw new Error("Approval hash must be 64 lowercase hexadecimal characters");
  validateMigrationPlan(plan);
  const calculated = hashPlan(plan);
  if (plan.planHash !== calculated || approvalHash !== calculated) throw new Error("Approval hash does not match the immutable plan");
  if (!["pilot", "resume"].includes(mode)) throw new Error("Apply mode must be pilot or resume");
  validateState(state, phases || (mode === "pilot" ? ["PILOT"] : ["APPLY"]));
  validateFlags(plan, config);
  return calculated;
}

function stateSaver(paths, supplied) {
  if (supplied) return (state) => supplied(paths, state);
  if (paths) return (state) => saveRunState(paths, state);
  return () => {};
}

function resultCounts() {
  return { completed: 0, failed: 0, skipped: 0, uncertain: 0, stoppedReason: null };
}

function updateCounts(state, result) {
  state.counts = {
    pending: Object.values(state.applyProgress || {}).filter((entry) => entry.status === "running").length,
    completed: Object.values(state.applyProgress || {}).filter((entry) => entry.status === "done").length,
    failed: result.failed,
    skipped: Object.values(state.applyProgress || {}).filter((entry) => entry.status === "skipped").length,
    uncertain: Object.values(state.applyProgress || {}).filter((entry) => entry.status === "uncertain").length,
  };
}

async function perform(adapter, action) {
  if (action.kind === "project") return adapter.createProject(action.projectName);
  if (action.action === "move") {
    const result = await adapter.moveConversation(action.conversationId, action.projectName);
    if (result?.status !== "verified") return result;
    return adapter.verifyConversationLocation(action.conversationId, action.projectName);
  }
  if (action.action === "archive") {
    const result = await adapter.archiveConversation(action.conversationId);
    if (result?.status !== "verified") return result;
    return adapter.verifyConversationLocation(action.conversationId, "archived");
  }
  throw new Error(`Unsupported write action: ${action.action}`);
}

function auditEvent(state, mode, action, key, status, stoppedReason) {
  const event = {
    type: "apply_action",
    runId: state.runId,
    actionKey: key,
    action: action.action,
    status,
    mode,
  };
  if (action.conversationId) event.conversationId = action.conversationId;
  if (action.projectName) event.projectName = action.projectName;
  if (stoppedReason) event.stoppedReason = stoppedReason;
  return event;
}

async function runApply({ plan, state, adapter, approvalHash, config, mode, maxActions = Infinity,
  paths, appendAudit = async () => {}, saveState } = {}) {
  validateApplyRequest({ plan, state, approvalHash, config, mode });
  if (!adapter || typeof adapter.getAccountFingerprint !== "function") throw new Error("A ChatGPT adapter is required");
  if (!(maxActions === Infinity || Number.isSafeInteger(maxActions) && maxActions > 0)) {
    throw new Error("maxActions must be a positive integer");
  }
  const actualFingerprint = await adapter.getAccountFingerprint();
  if (actualFingerprint !== state.accountFingerprint) throw new Error("Account fingerprint mismatch; zero actions performed");

  const result = resultCounts();
  const persist = stateSaver(paths, saveState);
  const limit = mode === "pilot" ? Math.min(maxActions, 5) : maxActions;
  let attempts = 0;
  state.applyProgress ||= {};
  const scheduledActions = actionsFor(plan);
  if (scheduledActions.some((action) => {
    const status = state.applyProgress[actionKey(action)]?.status;
    return status === "running" || status === "uncertain";
  })) {
    result.uncertain = 1;
    result.stoppedReason = "uncertain";
    return result;
  }

  for (const action of scheduledActions) {
    const key = actionKey(action);
    const progress = state.applyProgress[key];
    if (action.action === "keep" || action.planStatus === "done" || progress?.status === "done" || progress?.status === "skipped") {
      result.skipped++;
      if (!progress && action.action === "keep") state.applyProgress[key] = { status: "skipped" };
      continue;
    }
    if (progress?.status === "running" || progress?.status === "uncertain") {
      result.uncertain++;
      result.stoppedReason = "uncertain";
      return result;
    }
    if (attempts >= limit) break;

    state.applyProgress[key] = { status: "running" };
    updateCounts(state, result);
    persist(state);
    await appendAudit(auditEvent(state, mode, action, key, "running"));
    attempts++;

    let operationResult;
    try {
      operationResult = await perform(adapter, action);
    } catch {
      operationResult = { status: "browser_interrupted" };
    }
    const status = operationResult?.status;
    if (status !== "verified") {
      const stoppedReason = stopStatuses.has(status) ? status : "browser_interrupted";
      state.applyProgress[key] = { status: "uncertain" };
      result.uncertain++;
      result.stoppedReason = stoppedReason;
      updateCounts(state, result);
      persist(state);
      await appendAudit(auditEvent(state, mode, action, key, "uncertain", stoppedReason));
      return result;
    }

    state.applyProgress[key] = { status: "done" };
    result.completed++;
    updateCounts(state, result);
    persist(state);
    await appendAudit(auditEvent(state, mode, action, key, "done"));
  }
  updateCounts(state, result);
  return result;
}

module.exports = { runApply, validateApplyRequest, actionKey };
