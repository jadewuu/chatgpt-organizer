const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPaths } = require("../src/core/paths");
const {
  createRunState,
  loadRunState,
  saveRunState,
  transitionState,
} = require("../src/core/state");

test("cannot skip plan review and pilot approval", () => {
  const state = createRunState("run-fixture", "account-fixture");
  state.phase = "CLASSIFY";
  assert.throws(() => transitionState(state, "PILOT"), /Invalid transition/);
});

test("allows the approved path into the pilot", () => {
  const state = createRunState("run-fixture", "account-fixture");
  for (const phase of [
    "AUTHENTICATE", "DISCOVER", "TAXONOMY_REVIEW", "CLASSIFY",
    "PLAN_REVIEW", "PILOT_APPROVAL", "PILOT",
  ]) transitionState(state, phase);
  assert.equal(state.phase, "PILOT");
});

test("persists run state atomically with private permissions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const state = createRunState("run-fixture", "account-fixture");

  assert.equal(loadRunState(paths), null);
  saveRunState(paths, state);

  assert.deepEqual(loadRunState(paths), state);
  assert.equal(fs.existsSync(path.join(paths.state, "run.json.tmp")), false);
  assert.equal(fs.statSync(paths.state).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(paths.state, "run.json")).mode & 0o777, 0o600);
});
