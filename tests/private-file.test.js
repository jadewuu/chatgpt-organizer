const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createPaths } = require("../src/core/paths");
const { writePrivateFile } = require("../src/core/private-file");

function createSymlinkOrSkip(t, target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (["EACCES", "EPERM", "ENOSYS"].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test("a pre-planted review.html.tmp symlink cannot redirect report contents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  fs.mkdirSync(paths.reports, { recursive: true });
  const referent = path.join(root, "outside.txt");
  fs.writeFileSync(referent, "outside stays unchanged\n");
  const predictableTemporary = path.join(paths.reports, "review.html.tmp");
  if (!createSymlinkOrSkip(t, referent, predictableTemporary, "file")) return;

  const target = path.join(paths.reports, "review.html");
  writePrivateFile(paths, paths.reports, target, "private report\n");

  assert.equal(fs.readFileSync(target, "utf8"), "private report\n");
  assert.equal(fs.readFileSync(referent, "utf8"), "outside stays unchanged\n");
  assert.equal(fs.lstatSync(predictableTemporary).isSymbolicLink(), true);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
});

test("rejects a symlinked report directory without writing through it", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(paths.local, { mode: 0o700 });
  if (!createSymlinkOrSkip(t, outside, paths.reports, "dir")) return;

  assert.throws(
    () => writePrivateFile(paths, paths.reports, path.join(paths.reports, "review.html"), "private report\n"),
    /symlink|directory|private artifact/i,
  );
  assert.equal(fs.existsSync(path.join(outside, "review.html")), false);
});

test("rejects symlinked and non-directory private path components", (t) => {
  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-file-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-outside-"));
  t.after(() => fs.rmSync(symlinkRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const symlinkPaths = createPaths(symlinkRoot);
  if (!createSymlinkOrSkip(t, outside, symlinkPaths.local, "dir")) return;
  assert.throws(
    () => writePrivateFile(symlinkPaths, symlinkPaths.plans, path.join(symlinkPaths.plans, "plan.json"), "plan\n"),
    /symlink|directory/i,
  );
  assert.deepEqual(fs.readdirSync(outside), []);

  const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-file-"));
  t.after(() => fs.rmSync(fileRoot, { recursive: true, force: true }));
  const filePaths = createPaths(fileRoot);
  fs.writeFileSync(filePaths.local, "not a directory\n");
  assert.throws(
    () => writePrivateFile(filePaths, filePaths.plans, path.join(filePaths.plans, "plan.json"), "plan\n"),
    /directory/i,
  );

  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-file-"));
  t.after(() => fs.rmSync(artifactRoot, { recursive: true, force: true }));
  const artifactPaths = createPaths(artifactRoot);
  fs.mkdirSync(artifactPaths.local, { mode: 0o700 });
  fs.writeFileSync(artifactPaths.plans, "not a directory\n");
  assert.throws(
    () => writePrivateFile(artifactPaths, artifactPaths.plans, path.join(artifactPaths.plans, "plan.json"), "plan\n"),
    /directory/i,
  );
});

test("cleans up its temporary file after a write failure", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const target = path.join(paths.reports, "review.html");

  assert.throws(() => writePrivateFile(paths, paths.reports, target, {}), /data|argument|string|buffer/i);
  assert.deepEqual(fs.readdirSync(paths.reports), []);
  assert.equal(fs.existsSync(target), false);
});

test("cleans up its temporary file after an atomic rename failure", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const target = path.join(paths.plans, "migration-plan.json");
  fs.mkdirSync(target, { recursive: true });

  assert.throws(() => writePrivateFile(paths, paths.plans, target, "plan\n"));
  assert.deepEqual(fs.readdirSync(paths.plans), ["migration-plan.json"]);
  assert.equal(fs.lstatSync(target).isDirectory(), true);
});

test("replaces a target symlink without modifying its referent", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-private-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  fs.mkdirSync(paths.reports, { recursive: true });
  const referent = path.join(root, "outside.txt");
  const target = path.join(paths.reports, "review.html");
  fs.writeFileSync(referent, "outside stays unchanged\n");
  if (!createSymlinkOrSkip(t, referent, target, "file")) return;

  writePrivateFile(paths, paths.reports, target, "replacement report\n");

  assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(target, "utf8"), "replacement report\n");
  assert.equal(fs.readFileSync(referent, "utf8"), "outside stays unchanged\n");
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
});
