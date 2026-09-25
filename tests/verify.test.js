const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { actionKey } = require("../src/core/apply-engine");
const { createPaths } = require("../src/core/paths");
const { hashPlan } = require("../src/core/planner");
const { loadRunState, saveRunState } = require("../src/core/state");
const { run } = require("../src/commands/verify");
const createWrapper = require("../scripts/07-create-projects");
const moveWrapper = require("../scripts/08-phase2-move");
const archiveWrapper = require("../scripts/09-phase2-archive");

function item(id, changes = {}) {
  return {
    conversationId: id,
    project: "Work",
    confidence: 0.99,
    reason: "Synthetic fixture",
    suggestedAction: "move",
    action: "move",
    title: `Fixture ${id}`,
    url: `https://chatgpt.com/c/${id}`,
    currentProject: null,
    status: "proposed",
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

function keyFor(itemValue) {
  return actionKey({
    kind: "conversation",
    action: itemValue.action,
    conversationId: itemValue.conversationId,
    projectName: itemValue.project,
  });
}

function fixture(t, { approvedPlan, phase = "PILOT", entries, stateChanges = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "organizer-verify-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  fs.mkdirSync(paths.plans, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.state, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(paths.plans, "migration-plan.json"), `${JSON.stringify(approvedPlan)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(paths.state, "account.json"), '{"accountFingerprint":"account-fixture","workspaceFingerprint":"workspace-fixture"}\n', { mode: 0o600 });
  const runState = {
    runId: "run-fixture",
    accountFingerprint: "account-fixture",
    workspaceFingerprint: "workspace-fixture",
    phase,
    planHash: approvedPlan.planHash,
    approvals: {
      pilot: { planHash: approvedPlan.planHash },
      ...(phase === "APPLY" || phase === "VERIFY" ? { full: { planHash: approvedPlan.planHash } } : {}),
    },
    applyProgress: { planHash: approvedPlan.planHash, entries },
    ...stateChanges,
  };
  saveRunState(paths, runState);
  return { paths, runState };
}

class VerifyAdapter {
  constructor({ projects = ["Work"], results = {}, fingerprint = "account-fixture", workspaceFingerprint = "workspace-fixture" } = {}) {
    this.projects = projects;
    this.results = results;
    this.fingerprint = fingerprint;
    this.workspaceFingerprint = workspaceFingerprint;
    this.calls = [];
    this.closed = false;
  }
  async getAccountFingerprint(options = {}) {
    this.calls.push(["fingerprint", options.workspaceFingerprint]);
    if (options.workspaceFingerprint !== this.workspaceFingerprint) throw new Error("Workspace fingerprint mismatch");
    return this.fingerprint;
  }
  async listProjects() { this.calls.push(["projects"]); return this.projects.map((name) => ({ name, url: "https://chatgpt.com/g/g-p-fixture/project" })); }
  async verifyConversationLocation(id, expected) {
    this.calls.push(["conversation", id, expected]);
    return this.results[id] || { status: "verified", evidence: "SECRET UI CONTENT" };
  }
  async close() { this.closed = true; }
}

test("verified pilot checks every done write, skips keep items, and advances to APPLY_APPROVAL", async (t) => {
  const move = item("fixture-move");
  const archive = item("fixture-archive", { project: null, suggestedAction: "archive", action: "archive", archiveReason: "Synthetic stale fixture" });
  const keep = item("fixture-keep", { project: null, suggestedAction: "keep", action: "keep", status: "unresolved" });
  const approvedPlan = plan([move, archive, keep], [
    { name: "Work", exists: false, createRequired: true, proposedConversationCount: 1 },
  ]);
  const entries = {
    [actionKey({ kind: "project", action: "createProject", projectName: "Work" })]: { status: "done" },
    [keyFor(move)]: { status: "done" },
    [keyFor(archive)]: { status: "done" },
    [keyFor(keep)]: { status: "skipped" },
  };
  const { paths } = fixture(t, { approvedPlan, entries });
  const adapter = new VerifyAdapter();
  const output = [];
  const code = await run([], { paths, createAdapter: () => adapter, stdout: { write: (value) => output.push(value) } });
  assert.equal(code, 0);
  assert.deepEqual(adapter.calls, [
    ["fingerprint", "workspace-fixture"], ["projects"],
    ["conversation", "fixture-move", { kind: "project", name: "Work" }],
    ["conversation", "fixture-archive", { kind: "archived" }],
  ]);
  const saved = loadRunState(paths);
  assert.equal(saved.phase, "APPLY_APPROVAL");
  assert.deepEqual(saved.pilotVerification, { status: "verified", planHash: approvedPlan.planHash });
  const audit = fs.readFileSync(path.join(paths.audit, "events.jsonl"), "utf8");
  assert.doesNotMatch(audit, /SECRET|UI CONTENT/);
  assert.equal(audit.trim().split("\n").length, 3);
  const event = JSON.parse(audit.trim().split("\n")[1]);
  assert.equal(event.provider, "chatgpt");
  assert.ok(Number.isFinite(Date.parse(event.timestamp)));
  assert.deepEqual(event.previousLocation, { kind: "unassigned" });
  assert.deepEqual(event.verificationEvidence, { method: "conversation_location", status: "verified" });
  assert.match(output.join(""), /"verified":3/);
});

test("a verification mismatch reports exact local IDs and never advances state", async (t) => {
  const move = item("fixture-needs-review");
  const approvedPlan = plan([move]);
  const { paths } = fixture(t, { approvedPlan, entries: { [keyFor(move)]: { status: "done" } } });
  const adapter = new VerifyAdapter({ results: { "fixture-needs-review": { status: "uncertain", evidence: "SECRET page" } } });
  const output = [];
  assert.equal(await run([], { paths, createAdapter: () => adapter, stdout: { write: (value) => output.push(value) } }), 1);
  assert.equal(loadRunState(paths).phase, "PILOT");
  assert.match(output.join(""), /fixture-needs-review/);
  assert.doesNotMatch(fs.readFileSync(path.join(paths.audit, "events.jsonl"), "utf8"), /SECRET/);
});

test("a browser interruption reports the current and remaining local IDs without advancing", async (t) => {
  const first = item("fixture-interrupted");
  const second = item("fixture-not-checked");
  const approvedPlan = plan([first, second]);
  const { paths } = fixture(t, {
    approvedPlan,
    entries: { [keyFor(first)]: { status: "done" }, [keyFor(second)]: { status: "done" } },
  });
  const adapter = new VerifyAdapter();
  adapter.verifyConversationLocation = async () => { throw new Error("Synthetic browser closed"); };
  const output = [];
  assert.equal(await run([], { paths, createAdapter: () => adapter, stdout: { write: (value) => output.push(value) } }), 1);
  assert.match(output.join(""), /fixture-interrupted/);
  assert.match(output.join(""), /fixture-not-checked/);
  assert.equal(loadRunState(paths).phase, "PILOT");
});

test("a fully covered full run persists APPLY to VERIFY to COMPLETE", async (t) => {
  const move = item("fixture-full");
  const approvedPlan = plan([move]);
  const { paths } = fixture(t, {
    approvedPlan,
    phase: "APPLY",
    entries: { [keyFor(move)]: { status: "done" } },
    stateChanges: { pilotVerification: { status: "verified", planHash: approvedPlan.planHash } },
  });
  const phases = [];
  assert.equal(await run([], {
    paths,
    createAdapter: () => new VerifyAdapter(),
    stdout: { write() {} },
    saveState(targetPaths, value) { phases.push(value.phase); saveRunState(targetPaths, value); },
  }), 0);
  assert.deepEqual(phases, ["VERIFY", "COMPLETE"]);
  assert.equal(loadRunState(paths).phase, "COMPLETE");
});

test("plan, account, progress, and interrupted-state mismatches fail before adapter construction", async (t) => {
  const move = item("fixture-guarded");
  const approvedPlan = plan([move]);
  const validEntries = { [keyFor(move)]: { status: "done" } };
  for (const scenario of ["plan", "account", "orphan", "running"]) {
    const { paths } = fixture(t, { approvedPlan, entries: validEntries });
    if (scenario === "plan") {
      const changed = { ...approvedPlan, items: [{ ...approvedPlan.items[0], project: "Changed" }] };
      fs.writeFileSync(path.join(paths.plans, "migration-plan.json"), JSON.stringify(changed));
    }
    if (scenario === "account") fs.writeFileSync(path.join(paths.state, "account.json"), '{"accountFingerprint":"other"}\n');
    if (scenario === "orphan") {
      const state = loadRunState(paths);
      state.applyProgress.entries['["conversation","archive","orphan"]'] = { status: "done" };
      saveRunState(paths, state);
    }
    if (scenario === "running") {
      const state = loadRunState(paths);
      state.applyProgress.entries[keyFor(move)] = { status: "running" };
      saveRunState(paths, state);
    }
    let constructions = 0;
    await assert.rejects(run([], {
      paths,
      createAdapter() { constructions++; return new VerifyAdapter(); },
      stdout: { write() {} },
    }), /plan|account|progress|running|manual review|hash|orphan|unknown/i);
    assert.equal(constructions, 0, scenario);
    assert.equal(loadRunState(paths).phase, "PILOT");
  }
});

test("verify rejects plan lifecycle status and workspace context mismatch before adapter construction", async (t) => {
  for (const scenario of ["plan-status", "missing-workspace", "changed-workspace"]) {
    const move = item("fixture-context", scenario === "plan-status" ? { status: "done" } : {});
    const approvedPlan = plan([move]);
    const { paths } = fixture(t, { approvedPlan, entries: { [keyFor(move)]: { status: "done" } } });
    if (scenario !== "plan-status") {
      const accountPath = path.join(paths.state, "account.json");
      const account = JSON.parse(fs.readFileSync(accountPath, "utf8"));
      if (scenario === "missing-workspace") delete account.workspaceFingerprint;
      else account.workspaceFingerprint = "different-workspace";
      fs.writeFileSync(accountPath, `${JSON.stringify(account)}\n`);
    }
    let constructions = 0;
    await assert.rejects(run([], {
      paths,
      createAdapter() { constructions++; return new VerifyAdapter(); },
      stdout: { write() {} },
    }), /status|proposed|workspace|account context/i);
    assert.equal(constructions, 0, scenario);
  }
});

test("verify compares the persisted workspace with live adapter context before observations", async (t) => {
  const move = item("fixture-live-workspace");
  const approvedPlan = plan([move]);
  const { paths } = fixture(t, { approvedPlan, entries: { [keyFor(move)]: { status: "done" } } });
  const adapter = new VerifyAdapter({ workspaceFingerprint: "other-workspace" });
  await assert.rejects(run([], { paths, createAdapter: () => adapter, stdout: { write() {} } }), /workspace/i);
  assert.deepEqual(adapter.calls, [["fingerprint", "workspace-fixture"]]);
  assert.equal(loadRunState(paths).phase, "PILOT");
});

test("pilot verification rejects progress claiming more than five completed writes", async (t) => {
  const items = Array.from({ length: 6 }, (_, index) => item(`fixture-${index}`));
  const approvedPlan = plan(items);
  const entries = Object.fromEntries(items.map((entry) => [keyFor(entry), { status: "done" }]));
  const { paths } = fixture(t, { approvedPlan, entries });
  let constructions = 0;
  await assert.rejects(run([], {
    paths,
    createAdapter() { constructions++; return new VerifyAdapter(); },
    stdout: { write() {} },
  }), /pilot|five|progress/i);
  assert.equal(constructions, 0);
});

test("full batch verification permits pending work but does not mark COMPLETE", async (t) => {
  const first = item("fixture-done");
  const missing = item("fixture-missing");
  const approvedPlan = plan([first, missing]);
  const { paths } = fixture(t, {
    approvedPlan,
    phase: "APPLY",
    entries: { [keyFor(first)]: { status: "done" } },
    stateChanges: { pilotVerification: { status: "verified", planHash: approvedPlan.planHash } },
  });
  let constructions = 0;
  const output = [];
  assert.equal(await run([], {
    paths,
    createAdapter() { constructions++; return new VerifyAdapter(); },
    stdout: { write: (value) => output.push(value) },
  }), 0);
  assert.equal(constructions, 1);
  assert.equal(loadRunState(paths).phase, "APPLY_APPROVAL");
});

test("resuming final VERIFY cannot mark an incomplete schedule COMPLETE", async (t) => {
  const approvedPlan = plan([item("fixture-pending")]);
  const { paths } = fixture(t, { approvedPlan, phase: "VERIFY", entries: {},
    stateChanges: { pilotVerification: { status: "verified", planHash: approvedPlan.planHash } } });
  let constructions = 0;
  await assert.rejects(run([], { paths, stdout: { write() {} },
    createAdapter() { constructions++; return new VerifyAdapter(); } }), /incomplete|pending/i);
  assert.equal(constructions, 0);
  assert.equal(loadRunState(paths).phase, "VERIFY");
});

test("31 actions require verified pilot and verified bounded continuation invocations", async (t) => {
  const { run: apply } = require("../src/commands/apply");
  const { FakeChatGPTAdapter } = require("./helpers/fake-chatgpt-adapter");
  const approvedPlan = plan(Array.from({ length: 31 }, (_, n) => item(`batch-${n}`)));
  const { paths } = fixture(t, { approvedPlan, phase: "PLAN_REVIEW", entries: {} });
  const actions = [];
  const deps = { paths, stdout: { write() {} }, config: { provider: "chatgpt", actions: { allowMove: true } },
    createAdapter() { const adapter = new FakeChatGPTAdapter(); adapter.actions = actions; return adapter; } };
  const args = (mode) => ["--mode", mode, "--approve", approvedPlan.planHash];
  assert.equal(await apply(args("pilot"), deps), 0);
  assert.equal(actions.length, 5);
  assert.equal(loadRunState(paths).counts.pending, 26);
  await assert.rejects(apply(args("resume"), deps), /phase/);
  assert.equal(await run([], deps), 0);
  assert.equal(await apply(args("resume"), deps), 0);
  assert.equal(actions.length, 30);
  assert.equal(loadRunState(paths).counts.pending, 1);
  await assert.rejects(apply(args("resume"), deps), /phase/);
  assert.equal(await run([], deps), 0);
  assert.equal(loadRunState(paths).phase, "APPLY_APPROVAL");
  assert.equal(await apply(args("resume"), deps), 0);
  assert.equal(actions.length, 31);
  assert.equal(await run([], deps), 0);
  assert.equal(loadRunState(paths).phase, "COMPLETE");
  assert.equal(new Set(actions.map((a) => a[1])).size, 31);
});

test("legacy write wrappers require the same mode and approval gates before delegation", async () => {
  for (const wrapper of [createWrapper, moveWrapper, archiveWrapper]) {
    let delegated = 0;
    await assert.rejects(wrapper.main([], { commands: { apply: async () => { delegated++; return 0; } } }), /mode|approve|usage/i);
    assert.equal(delegated, 0);
    const approval = "a".repeat(64);
    assert.equal(await wrapper.main(["--mode", "pilot", "--approve", approval], {
      commands: { apply: async (args) => { delegated++; assert.deepEqual(args, ["--mode", "pilot", "--approve", approval]); return 0; } },
      stdout: { write() {} }, stderr: { write() {} },
    }), 0);
    assert.equal(delegated, 1);
  }
});
