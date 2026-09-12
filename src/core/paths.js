const path = require("node:path");

function createPaths(rootDir = path.resolve(__dirname, "../..")) {
  const root = path.resolve(rootDir);
  const local = path.join(root, ".local");
  return {
    root,
    local,
    profile: path.join(local, "profile"),
    state: path.join(local, "state"),
    raw: path.join(local, "raw"),
    plans: path.join(local, "plans"),
    reports: path.join(local, "reports"),
    audit: path.join(local, "audit"),
    logs: path.join(local, "logs"),
  };
}

function assertInsideLocal(paths, targetPath) {
  const target = path.resolve(targetPath);
  if (target === paths.local || !target.startsWith(paths.local + path.sep)) {
    throw new Error(`Refusing target outside .local: ${target}`);
  }
  return target;
}

module.exports = { createPaths, assertInsideLocal };
