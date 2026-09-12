const test = require("node:test");
const assert = require("node:assert/strict");
const { auditTrackedFiles } = require("../scripts/privacy-audit");

test("rejects tracked private artifacts", () => {
  const findings = auditTrackedFiles([
    "README.md",
    "data/conversations.json",
    "progress.json",
    "profile/Default/Cookies",
  ]);
  assert.deepEqual(findings.map((item) => item.file), [
    "data/conversations.json",
    "progress.json",
    "profile/Default/Cookies",
  ]);
});

test("allows source and synthetic fixtures", () => {
  assert.deepEqual(auditTrackedFiles([
    "src/cli.js",
    "tests/fixtures/conversations.json",
  ]), []);
});
