const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { appendAudit } = require("../src/core/audit");
const { runApply } = require("../src/core/apply-engine");
const { run: runCommand } = require("../src/commands/apply");
const { createPaths } = require("../src/core/paths");
const { hashPlan } = require("../src/core/planner");
const { loadRunState, saveRunState } = require("../src/core/state");
const { FakeChatGPTAdapter } = require("./helpers/fake-chatgpt-adapter");

const enabled = {
  provider: "chatgpt",
  actions: { allowCreateProjects: true, allowMove: true, allowArchive: true, neverDelete: true },
};

function item(index, changes = {}) {
  return {
    conversationId: `fixture-${index}`,
    project: "Work",
    confidence: 0.99,
    reason: "Synthetic fixture",
    suggestedAction: "move",
    action: "move",
    title: `Fixture ${index}`,
    url: `https://chatgpt.com/c/fixture-${index}`,
    currentProject: null,
    status: "pending",
    ...changes,
  };
}

function plan(items, projects = []) {
  const value = {
    provider: "chatgpt",
    generatedAt: "2026-09-12T00:00:00.000Z",
    taxonomyHash: "taxonomy-fixture",
    projects,
    items,
  };
  value.planHash = hashPlan(value);
  return value;
}

function state(phase = "PILOT", changes = {}) {
  return { runId: "run-fixture", accountFingerprint: "account-fixture", phase, ...changes };
}

function temporaryPaths(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-apply-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return createPaths(root);
}

async function apply({ plan: approvedPlan, adapter = new FakeChatGPTAdapter(), state: runState = state(),
  config = enabled, mode = "pilot", maxActions = 99, paths, audit = async () => {} } = {}) {
  return runApply({
    plan: approvedPlan,
    state: runState,
    adapter,
    approvalHash: approvedPlan?.planHash,
    config,
    mode,
    maxActions,
    paths,
    appendAudit: audit,
  });
}

test("pilot caps write attempts at five", async () => {
  const adapter = new FakeChatGPTAdapter();
  const result = await apply({ plan: plan(Array.from({ length: 7 }, (_, index) => item(index))), adapter });
  assert.equal(result.completed, 5);
  assert.equal(adapter.actions.length, 5);
});

test("required Project creation counts toward the cap and runs before moves and archives", async () => {
  const adapter = new FakeChatGPTAdapter();
  const approvedPlan = plan([
    item(0, { action: "archive", suggestedAction: "archive", project: null, archiveReason: "Synthetic stale fixture" }),
    ...Array.from({ length: 5 }, (_, index) => item(index + 1)),
  ], [{ name: "Work", exists: false, createRequired: true, proposedConversationCount: 5 }]);
  const result = await apply({ plan: approvedPlan, adapter });
  assert.equal(result.completed, 5);
  assert.deepEqual(adapter.actions.map((entry) => entry[0]), ["createProject", "move", "move", "move", "move"]);
});

test("changed approval, changed plan, account mismatch, and invalid actions perform zero writes", async () => {
  for (const scenario of ["approval", "embeddedHash", "account", "action"]) {
    const adapter = new FakeChatGPTAdapter({ accountFingerprint: scenario === "account" ? "different" : "account-fixture" });
    const approvedPlan = plan([item(0)]);
    if (scenario === "embeddedHash") approvedPlan.items[0].project = "Changed";
    if (scenario === "action") approvedPlan.items[0].action = "delete";
    const createdPlan = approvedPlan;
    const createdHash = scenario === "approval" ? "0".repeat(64) : approvedPlan.planHash;
    await assert.rejects(runApply({
      plan: createdPlan, state: state(), adapter, approvalHash: createdHash,
      config: enabled, mode: "pilot", maxActions: 5, appendAudit: async () => {},
    }), /approval|hash|account|migration plan|action/i);
    assert.equal(adapter.actions.length, 0, scenario);
  }
});

test("disabled action flags fail before adapter methods are called", async () => {
  const cases = [
    [plan([item(0)]), { ...enabled, actions: { ...enabled.actions, allowMove: false } }],
    [plan([item(0, { action: "archive", suggestedAction: "archive", project: null, archiveReason: "Synthetic" })]), { ...enabled, actions: { ...enabled.actions, allowArchive: false } }],
    [plan([], [{ name: "Work", exists: false, createRequired: true, proposedConversationCount: 0 }]), { ...enabled, actions: { ...enabled.actions, allowCreateProjects: false } }],
  ];
  for (const [approvedPlan, config] of cases) {
    const adapter = new FakeChatGPTAdapter();
    await assert.rejects(apply({ plan: approvedPlan, adapter, config }), /disabled|allow/i);
    assert.equal(adapter.actions.length, 0);
  }
});

test("all safety-stop results stop immediately without retry", async () => {
  for (const status of ["rate_limited", "access_restricted", "selector_missing", "uncertain"]) {
    const adapter = new FakeChatGPTAdapter({ results: { "move:fixture-0": { status } } });
    const runState = state();
    const result = await apply({ plan: plan([item(0), item(1)]), adapter, state: runState });
    assert.equal(result.stoppedReason, status);
    assert.equal(result.uncertain, 1);
    assert.equal(adapter.actions.length, 1, status);
    assert.equal(Object.values(runState.applyProgress)[0].status, "uncertain");
  }
});

test("post-action verification must be verified", async () => {
  const adapter = new FakeChatGPTAdapter({ verificationResults: { "fixture-0": { status: "uncertain" } } });
  const result = await apply({ plan: plan([item(0), item(1)]), adapter });
  assert.equal(result.stoppedReason, "uncertain");
  assert.equal(adapter.actions.length, 1);
  assert.deepEqual(adapter.verifications, [["fixture-0", "Work"]]);
});

test("resume skips persisted done, keep, and plan-done items", async () => {
  const adapter = new FakeChatGPTAdapter();
  const approvedPlan = plan([
    item(0),
    item(1, { action: "keep", suggestedAction: "keep", project: null, status: "unresolved" }),
    item(2, { status: "done" }),
    item(3),
  ]);
  const firstKey = JSON.stringify(["conversation", "move", "fixture-0"]);
  const runState = state("APPLY", { applyProgress: { [firstKey]: { status: "done" } } });
  const result = await apply({ plan: approvedPlan, adapter, state: runState, mode: "resume" });
  assert.equal(result.completed, 1);
  assert.equal(result.skipped, 3);
  assert.deepEqual(adapter.actions, [["move", "fixture-3", "Work"]]);
});

test("resume stops instead of repeating a previously running or uncertain action", async () => {
  for (const prior of ["running", "uncertain"]) {
    const adapter = new FakeChatGPTAdapter();
    const key = JSON.stringify(["conversation", "move", "fixture-0"]);
    const runState = state("APPLY", { applyProgress: { [key]: { status: prior } } });
    const result = await apply({ plan: plan([item(0)]), adapter, state: runState, mode: "resume" });
    assert.equal(result.stoppedReason, "uncertain");
    assert.equal(adapter.actions.length, 0);
  }
});

test("resume detects any interrupted action before starting an earlier pending action", async () => {
  const adapter = new FakeChatGPTAdapter();
  const interruptedKey = JSON.stringify(["conversation", "archive", "fixture-1"]);
  const runState = state("APPLY", { applyProgress: { [interruptedKey]: { status: "running" } } });
  const approvedPlan = plan([
    item(0),
    item(1, { action: "archive", suggestedAction: "archive", project: null, archiveReason: "Synthetic" }),
  ]);
  const result = await apply({ plan: approvedPlan, adapter, state: runState, mode: "resume" });
  assert.equal(result.stoppedReason, "uncertain");
  assert.equal(adapter.actions.length, 0);
});

test("state is persisted running before an attempt and done only after verification", async (t) => {
  const paths = temporaryPaths(t);
  const runState = state();
  const snapshots = [];
  const adapter = new FakeChatGPTAdapter();
  await runApply({
    plan: plan([item(0)]), state: runState, adapter, approvalHash: plan([item(0)]).planHash,
    config: enabled, mode: "pilot", paths, appendAudit: async () => {},
    saveState: (_paths, value) => snapshots.push(JSON.parse(JSON.stringify(value))),
  });
  assert.deepEqual(snapshots.map((snapshot) => Object.values(snapshot.applyProgress)[0].status), ["running", "done"]);
});

test("apply never mutates the approved plan", async () => {
  const approvedPlan = plan([item(0)]);
  const before = JSON.stringify(approvedPlan);
  await apply({ plan: approvedPlan });
  assert.equal(JSON.stringify(approvedPlan), before);
});

test("browser interruption is persisted as uncertain without retry", async () => {
  const adapter = new FakeChatGPTAdapter();
  adapter.moveConversation = async (...args) => { adapter.actions.push(["move", ...args]); throw new Error("browser closed"); };
  const runState = state();
  const result = await apply({ plan: plan([item(0), item(1)]), adapter, state: runState });
  assert.equal(result.stoppedReason, "browser_interrupted");
  assert.equal(adapter.actions.length, 1);
  assert.equal(Object.values(runState.applyProgress)[0].status, "uncertain");
});

test("appendAudit writes private flushed JSONL, redacts forbidden data, and refuses symlinks", (t) => {
  const paths = temporaryPaths(t);
  appendAudit(paths, {
    type: "action", runId: "run-fixture", action: "move", status: "done",
    conversationId: "fixture-0", title: "SECRET TITLE", messageText: "SECRET MESSAGE",
    accountFingerprint: "SECRET ACCOUNT", adapterDump: { cookies: "SECRET COOKIE" },
  });
  const target = path.join(paths.audit, "events.jsonl");
  const text = fs.readFileSync(target, "utf8");
  assert.equal(fs.statSync(paths.audit).mode & 0o777, 0o700);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.equal(text.endsWith("\n"), true);
  assert.doesNotMatch(text, /SECRET/);
  assert.deepEqual(JSON.parse(text), {
    type: "action", runId: "run-fixture", action: "move", status: "done", conversationId: "fixture-0",
  });

  fs.unlinkSync(target);
  const outside = path.join(path.dirname(paths.local), "outside-audit.txt");
  fs.writeFileSync(outside, "unchanged\n");
  fs.symlinkSync(outside, target);
  assert.throws(() => appendAudit(paths, { type: "action" }), /symlink|private|audit/i);
  assert.equal(fs.readFileSync(outside, "utf8"), "unchanged\n");
});

test("appendAudit never records arbitrary status or error text", (t) => {
  const paths = temporaryPaths(t);
  appendAudit(paths, {
    type: "apply_action",
    status: "SECRET adapter dump",
    stoppedReason: "SECRET browser error",
  });
  const text = fs.readFileSync(path.join(paths.audit, "events.jsonl"), "utf8");
  assert.doesNotMatch(text, /SECRET/);
  assert.deepEqual(JSON.parse(text), { type: "apply_action" });
});

function writeCommandFixture(t, { approvedPlan = plan([item(0)]), runState = state("PLAN_REVIEW"), config = enabled } = {}) {
  const paths = temporaryPaths(t);
  fs.mkdirSync(paths.plans, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(paths.plans, "migration-plan.json"), `${JSON.stringify(approvedPlan)}\n`, { mode: 0o600 });
  saveRunState(paths, runState);
  return { paths, approvedPlan, config };
}

test("apply command rejects malformed approval and disabled flags before constructing an adapter", async (t) => {
  for (const scenario of ["missing", "malformed", "disabled"]) {
    const config = scenario === "disabled"
      ? { ...enabled, actions: { ...enabled.actions, allowMove: false } }
      : enabled;
    const fixture = writeCommandFixture(t, { config });
    let constructions = 0;
    const args = scenario === "missing" ? ["--mode", "pilot"]
      : ["--mode", "pilot", "--approve", scenario === "malformed" ? "NO" : fixture.approvedPlan.planHash];
    await assert.rejects(runCommand(args, {
      paths: fixture.paths, rootDir: fixture.paths.root, config,
      createAdapter() { constructions++; return new FakeChatGPTAdapter(); },
    }), /approve|hash|disabled|allow/i);
    assert.equal(constructions, 0, scenario);
  }
});

test("pilot command records approval and persists PLAN_REVIEW through PILOT_APPROVAL to PILOT", async (t) => {
  const fixture = writeCommandFixture(t);
  const phases = [];
  const adapter = new FakeChatGPTAdapter();
  const code = await runCommand(["--mode", "pilot", "--approve", fixture.approvedPlan.planHash], {
    paths: fixture.paths, rootDir: fixture.paths.root, config: fixture.config,
    createAdapter: () => adapter,
    saveState(paths, value) { phases.push(value.phase); saveRunState(paths, value); },
    appendAudit: async () => {}, stdout: { write() {} },
  });
  assert.equal(code, 0);
  assert.deepEqual(phases.slice(0, 2), ["PILOT_APPROVAL", "PILOT"]);
  const saved = loadRunState(fixture.paths);
  assert.equal(saved.phase, "PILOT");
  assert.equal(saved.approvals.pilot.planHash, fixture.approvedPlan.planHash);
  assert.equal(adapter.closed, true);
});

test("account mismatch leaves command state at PLAN_REVIEW with zero actions", async (t) => {
  const fixture = writeCommandFixture(t);
  const adapter = new FakeChatGPTAdapter({ accountFingerprint: "different-account" });
  await assert.rejects(runCommand(["--mode", "pilot", "--approve", fixture.approvedPlan.planHash], {
    paths: fixture.paths,
    rootDir: fixture.paths.root,
    config: fixture.config,
    createAdapter: () => adapter,
    appendAudit: async () => {},
    stdout: { write() {} },
  }), /account.*mismatch/i);
  assert.equal(loadRunState(fixture.paths).phase, "PLAN_REVIEW");
  assert.equal(adapter.actions.length, 0);
  assert.equal(adapter.closed, true);
});

test("resume command requires verified pilot and records full approval", async (t) => {
  const approvedPlan = plan([item(0)]);
  const unverified = writeCommandFixture(t, { approvedPlan, runState: state("APPLY_APPROVAL") });
  let constructions = 0;
  await assert.rejects(runCommand(["--mode", "resume", "--approve", approvedPlan.planHash], {
    paths: unverified.paths, rootDir: unverified.paths.root, config: enabled,
    createAdapter() { constructions++; return new FakeChatGPTAdapter(); },
  }), /pilot.*verif/i);
  assert.equal(constructions, 0);

  const verified = writeCommandFixture(t, {
    approvedPlan,
    runState: state("APPLY_APPROVAL", { pilotVerification: { status: "verified", planHash: approvedPlan.planHash } }),
  });
  const phases = [];
  const code = await runCommand(["--mode", "resume", "--approve", approvedPlan.planHash], {
    paths: verified.paths, rootDir: verified.paths.root, config: enabled,
    createAdapter: () => new FakeChatGPTAdapter(), appendAudit: async () => {}, stdout: { write() {} },
    saveState(paths, value) { phases.push(value.phase); saveRunState(paths, value); },
  });
  assert.equal(code, 0);
  assert.equal(phases[0], "APPLY");
  assert.equal(loadRunState(verified.paths).approvals.full.planHash, approvedPlan.planHash);
});
