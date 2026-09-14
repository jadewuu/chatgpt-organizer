const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPaths } = require("../src/core/paths");
const {
  cleanData,
  parseArguments,
  resolveCleanupTargets,
  run,
} = require("../src/commands/clean-data");

const validRunId = crypto.randomUUID();

function temporaryPaths(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-clean-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return createPaths(root);
}

function writeRunState(paths, state = {}) {
  fs.mkdirSync(paths.state, { recursive: true });
  fs.writeFileSync(path.join(paths.state, "run.json"), JSON.stringify({
    runId: validRunId,
    accountFingerprint: "account-fixture",
    phase: "COMPLETE",
    ...state,
  }));
}

function capture() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; },
  };
}

test("normal cleanup excludes the browser profile", () => {
  const paths = createPaths(path.resolve("/tmp/chatgpt-organizer-test"));
  const targets = resolveCleanupTargets(paths, { includeProfile: false });
  assert.deepEqual(targets, [paths.raw, paths.plans, paths.reports, paths.audit, paths.logs]);
  assert.equal(targets.includes(paths.profile), false);
});

test("profile cleanup is separately explicit", () => {
  const paths = createPaths(path.resolve("/tmp/chatgpt-organizer-test"));
  const targets = resolveCleanupTargets(paths, { includeProfile: true });
  assert.deepEqual(targets, [paths.raw, paths.plans, paths.reports, paths.audit, paths.logs, paths.profile]);
});

test("cleanup accepts only one optional profile flag", () => {
  assert.deepEqual(parseArguments([]), { includeProfile: false });
  assert.deepEqual(parseArguments(["--include-profile"]), { includeProfile: true });
  for (const argv of [["--other"], ["--include-profile", "--include-profile"], ["value"]]) {
    assert.throws(() => parseArguments(argv), /only --include-profile/i);
  }
});

test("rejects missing or malformed persisted run state before prompting", async (t) => {
  const paths = temporaryPaths(t);
  let prompts = 0;
  let removals = 0;
  const deps = {
    paths,
    readConfirmation: async () => { prompts++; return validRunId; },
    remove: () => { removals++; },
  };

  await assert.rejects(run([], deps), /valid persisted run state/i);
  fs.mkdirSync(paths.state, { recursive: true });
  fs.writeFileSync(path.join(paths.state, "run.json"), "not-json");
  await assert.rejects(run([], deps), /valid persisted run state/i);
  fs.writeFileSync(path.join(paths.state, "run.json"), JSON.stringify({ runId: "run-fixture", phase: "COMPLETE" }));
  await assert.rejects(run([], deps), /valid persisted run state/i);
  fs.writeFileSync(path.join(paths.state, "run.json"), JSON.stringify({
    runId: "not-random",
    accountFingerprint: "account-fixture",
    phase: "COMPLETE",
  }));
  await assert.rejects(run([], deps), /valid persisted run state/i);
  assert.equal(prompts, 0);
  assert.equal(removals, 0);
});

test("prints exact targets in order before requesting the run ID", async (t) => {
  const paths = temporaryPaths(t);
  writeRunState(paths);
  const output = capture();
  let observedBeforePrompt = "";
  const removals = [];
  const code = await run([], {
    paths,
    stdout: output.stream,
    readConfirmation: async () => { observedBeforePrompt = output.read(); return "wrong-run"; },
    remove: (target) => removals.push(target),
  });

  assert.equal(code, 1);
  assert.deepEqual(removals, []);
  let previous = -1;
  for (const target of [paths.raw, paths.plans, paths.reports, paths.audit, paths.logs]) {
    const current = observedBeforePrompt.indexOf(target);
    assert.ok(current > previous, `target was not printed in order: ${target}`);
    previous = current;
  }
  assert.equal(observedBeforePrompt.includes(paths.profile), false);
});

test("profile removal requires a separate re-login confirmation before any removal", async (t) => {
  const paths = temporaryPaths(t);
  writeRunState(paths);
  const prompts = [];
  const removals = [];
  const answers = [validRunId, "cancel"];
  const code = await run(["--include-profile"], {
    paths,
    readConfirmation: async (prompt) => { prompts.push(prompt); return answers.shift(); },
    remove: (target) => removals.push(target),
    stdout: capture().stream,
  });

  assert.equal(code, 1);
  assert.deepEqual(removals, []);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /log in again/i);
});

test("confirmed normal cleanup removes only data artifacts and preserves state and profile", async (t) => {
  const paths = temporaryPaths(t);
  writeRunState(paths);
  for (const target of [paths.raw, paths.plans, paths.reports, paths.audit, paths.logs, paths.profile]) {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "fixture.txt"), "synthetic");
  }
  const workspaceFile = path.join(paths.root, "keep.txt");
  fs.writeFileSync(workspaceFile, "keep");

  const code = await run([], {
    paths,
    readConfirmation: async () => validRunId,
    stdout: capture().stream,
  });

  assert.equal(code, 0);
  for (const target of [paths.raw, paths.plans, paths.reports, paths.audit, paths.logs]) {
    assert.equal(fs.existsSync(target), false);
  }
  assert.equal(fs.existsSync(path.join(paths.state, "run.json")), true);
  assert.equal(fs.existsSync(path.join(paths.profile, "fixture.txt")), true);
  assert.equal(fs.readFileSync(workspaceFile, "utf8"), "keep");
});

test("cleanup removes a symlink itself without following its destination", (t) => {
  const paths = temporaryPaths(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-clean-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "sentinel.txt"), "keep");
  fs.mkdirSync(paths.local, { recursive: true });
  fs.symlinkSync(outside, paths.raw, "dir");

  const removed = cleanData(paths, { includeProfile: false });

  assert.deepEqual(removed, [paths.raw, paths.plans, paths.reports, paths.audit, paths.logs]);
  assert.equal(fs.existsSync(paths.raw), false);
  assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "keep");
});

test("unexpected cleanup paths are rejected before removal", () => {
  const paths = createPaths(path.resolve("/tmp/chatgpt-organizer-test"));
  const removals = [];
  assert.throws(() => cleanData({ ...paths, raw: paths.root }, {
    remove: (target) => removals.push(target),
  }), /outside|unexpected/i);
  assert.throws(() => cleanData({ ...paths, raw: paths.local }, {
    remove: (target) => removals.push(target),
  }), /outside|unexpected/i);
  const unrelatedLocal = path.resolve("/tmp/unrelated-local");
  assert.throws(() => cleanData({
    ...paths,
    local: unrelatedLocal,
    raw: path.join(unrelatedLocal, "raw"),
    plans: path.join(unrelatedLocal, "plans"),
    reports: path.join(unrelatedLocal, "reports"),
    audit: path.join(unrelatedLocal, "audit"),
    logs: path.join(unrelatedLocal, "logs"),
  }, { remove: (target) => removals.push(target) }), /unexpected.*\.local|private local/i);
  assert.deepEqual(removals, []);
});

test("rejects a symlinked .local parent instead of deleting through it", (t) => {
  const paths = temporaryPaths(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-clean-parent-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(outside, "raw"));
  fs.writeFileSync(path.join(outside, "raw", "sentinel.txt"), "keep");
  fs.symlinkSync(outside, paths.local, "dir");

  assert.throws(() => cleanData(paths), /symlinked.*\.local/i);
  assert.equal(fs.readFileSync(path.join(outside, "raw", "sentinel.txt"), "utf8"), "keep");
});

test("rejects a dangling .local symlink", (t) => {
  const paths = temporaryPaths(t);
  fs.symlinkSync(path.join(paths.root, "missing-target"), paths.local, "dir");
  assert.throws(() => cleanData(paths), /symlinked.*\.local/i);
  assert.equal(fs.lstatSync(paths.local).isSymbolicLink(), true);
});

test("a removal failure stops cleanup and reports the exact failed target", () => {
  const paths = createPaths(path.resolve("/tmp/chatgpt-organizer-test"));
  const removals = [];
  assert.throws(() => cleanData(paths, {
    remove(target) {
      removals.push(target);
      if (target === paths.plans) throw new Error("fixture failure");
    },
  }), new RegExp(`Failed to remove ${paths.plans.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: fixture failure`));
  assert.deepEqual(removals, [paths.raw, paths.plans]);
});
