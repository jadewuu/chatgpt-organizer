const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("../src/core/config");

test("loads the synthetic taxonomy and safe action defaults", () => {
  const config = loadConfig(path.join(__dirname, "fixtures/taxonomy.yaml"));
  assert.equal(config.classification.moveThreshold, 0.95);
  assert.equal(config.actions.allowMove, false);
  assert.equal(config.actions.allowArchive, false);
  assert.equal(config.actions.neverDelete, true);
  assert.deepEqual(config.taxonomy.projects.map((project) => project.name), ["Work", "Learning"]);
});

test("never enables deletion from configuration", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "organizer.yaml");
  fs.writeFileSync(filePath, "actions:\n  neverDelete: false\n");
  const config = loadConfig(filePath);
  assert.equal(config.actions.neverDelete, true);
});

test("rejects providers other than chatgpt", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "organizer.yaml");
  fs.writeFileSync(filePath, "provider: claude\n");
  assert.throws(() => loadConfig(filePath), /provider/);
});

test("rejects unsafe classification thresholds", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [key, value] of [
    ["moveThreshold", "-0.01"],
    ["moveThreshold", "1.01"],
    ["moveThreshold", '"0.95"'],
    ["fullContentBelow", ".inf"],
  ]) {
    const filePath = path.join(directory, `${key}-${value.replaceAll(/[^a-z0-9]/gi, "-")}.yaml`);
    fs.writeFileSync(filePath, `classification:\n  ${key}: ${value}\n`);
    assert.throws(() => loadConfig(filePath), new RegExp(key));
  }
});

test("rejects malformed configuration sections", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [section, value] of [
    ["classification", "[]"],
    ["actions", "false"],
    ["taxonomy", "[]"],
  ]) {
    const filePath = path.join(directory, `${section}.yaml`);
    fs.writeFileSync(filePath, `${section}: ${value}\n`);
    assert.throws(() => loadConfig(filePath), new RegExp(section));
  }
});
