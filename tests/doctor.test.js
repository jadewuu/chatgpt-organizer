const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runDoctor } = require("../src/commands/doctor");
const { main } = require("../src/cli");

function outputBuffer() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; },
  };
}

test("fails closed when Chrome is missing", async () => {
  const checks = await runDoctor({
    nodeVersion: "20.19.0",
    platform: "darwin",
    chromeExists: false,
    privatePathsIgnored: true,
  });
  assert.equal(checks.find((c) => c.name === "chrome").status, "fail");
});

test("warns instead of claiming support on non-macOS", async () => {
  const checks = await runDoctor({
    nodeVersion: "20.19.0",
    platform: "linux",
    chromeExists: true,
    privatePathsIgnored: true,
  });
  assert.equal(checks.find((c) => c.name === "platform").status, "warn");
});

test("runs static checks without invoking an opt-in browser check", async () => {
  let browserChecks = 0;
  const checks = await runDoctor({
    nodeVersion: "20.19.0",
    platform: "darwin",
    chromeExists: true,
    privatePathsIgnored: true,
    browserCheck: async () => { browserChecks += 1; return []; },
  });
  assert.equal(browserChecks, 0);
  assert.ok(checks.every((check) => ["ok", "warn", "fail"].includes(check.status)));
});

test("runs the browser check only when explicitly requested", async () => {
  let browserChecks = 0;
  const checks = await runDoctor({
    nodeVersion: "20.19.0",
    platform: "darwin",
    chromeExists: true,
    privatePathsIgnored: true,
    browser: true,
    browserCheck: async () => { browserChecks += 1; return [{ name: "login", status: "ok", message: "session available" }]; },
  });
  assert.equal(browserChecks, 1);
  assert.equal(checks.find((check) => check.name === "login").status, "ok");
});

test("doctor command returns zero for warnings but one for failures", async () => {
  const okOutput = outputBuffer();
  const okCode = await main(["doctor"], {
    doctor: async () => [{ name: "platform", status: "warn", message: "unsupported platform" }],
    stdout: okOutput.stream,
    stderr: okOutput.stream,
  });
  assert.equal(okCode, 0);
  assert.match(okOutput.read(), /platform/);

  const failOutput = outputBuffer();
  const failCode = await main(["doctor"], {
    doctor: async () => [{ name: "chrome", status: "fail", message: "missing" }],
    stdout: failOutput.stream,
    stderr: failOutput.stream,
  });
  assert.equal(failCode, 1);
  assert.match(failOutput.read(), /missing/);
});

test("returns two for an unknown command without loading later commands", async () => {
  const output = outputBuffer();
  const code = await main(["unknown"], { stdout: output.stream, stderr: output.stream });
  assert.equal(code, 2);
  assert.match(output.read(), /doctor\|plan\|apply\|verify\|clean:data/);
});

test("reports command failures without an unhandled rejection", async () => {
  const output = outputBuffer();
  const code = await main(["doctor"], {
    doctor: async () => { throw new Error("doctor exploded"); },
    stdout: output.stream,
    stderr: output.stream,
  });
  assert.equal(code, 1);
  assert.match(output.read(), /doctor exploded/);
});

test("static checks cover paths, ignore rules, configuration, and writable directories", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-doctor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, "organizer.yaml");
  fs.writeFileSync(configPath, "provider: chatgpt\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".local/\n");
  const checks = await runDoctor({
    rootDir: root,
    nodeVersion: "20.19.0",
    platform: "darwin",
    chromeExists: true,
    configPath,
    privatePathsIgnored: true,
    writableLocalDirs: true,
  });
  for (const name of ["paths", "ignore", "config", "writable"]) {
    assert.ok(checks.some((check) => check.name === name), name);
  }
  assert.ok(checks.every((check) => typeof check.message === "string"));
});

test("fails closed for a missing explicitly configured file", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-doctor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const checks = await runDoctor({ rootDir: root, configPath: path.join(root, "missing.yaml") });
  assert.equal(checks.find((check) => check.name === "config").status, "fail");
});

test("returns a failed writable check for incomplete path contracts", async () => {
  const checks = await runDoctor({ paths: { local: "/tmp/private" } });
  assert.equal(checks.find((check) => check.name === "paths").status, "fail");
  assert.equal(checks.find((check) => check.name === "writable").status, "fail");
});
