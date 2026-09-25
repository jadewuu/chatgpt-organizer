const test = require("node:test");
const assert = require("node:assert/strict");
const { auditTrackedFiles } = require("../scripts/privacy-audit");

test("rejects force-added execution artifacts and personalized action configuration", () => {
  const files = [".superpowers/review.md", ".worktrees/branch/README.md", "config/organizer.yaml"];
  assert.deepEqual(auditTrackedFiles(files).map((item) => item.file), files);
});

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
