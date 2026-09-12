const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createPaths, assertInsideLocal } = require("../src/core/paths");

test("all private paths live below .local", () => {
  const root = path.resolve("/tmp/chatgpt-organizer-test");
  const paths = createPaths(root);
  for (const key of ["profile", "state", "raw", "plans", "reports", "audit", "logs"]) {
    assert.equal(paths[key].startsWith(paths.local + path.sep), true, key);
  }
});

test("rejects cleanup targets outside .local", () => {
  const paths = createPaths(path.resolve("/tmp/chatgpt-organizer-test"));
  assert.throws(() => assertInsideLocal(paths, paths.root), /outside \.local/);
  assert.equal(assertInsideLocal(paths, paths.raw), paths.raw);
});
