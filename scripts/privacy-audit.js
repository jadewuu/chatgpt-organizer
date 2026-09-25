const { execFileSync } = require("node:child_process");

const forbidden = [
  /^\.local\//,
  /^\.superpowers\//,
  /^\.worktrees\//,
  /^config\/organizer\.yaml$/,
  /^data\//,
  /^profile\//,
  /^chrome-profile\//,
  /^logs\//,
  /^migration-plan\.json$/,
  /^progress\.json$/,
  /^review\.md$/,
  /^stats\.md$/,
  /^AGENT\.md$/,
  /^PROJECT_MAP\.md$/,
];

function auditTrackedFiles(files) {
  return files
    .filter((file) => forbidden.some((pattern) => pattern.test(file)))
    .map((file) => ({ file, reason: "private or legacy user-derived artifact" }));
}

function main() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  const findings = auditTrackedFiles(output.split("\0").filter(Boolean));
  if (findings.length) {
    for (const finding of findings) process.stderr.write(`${finding.file}: ${finding.reason}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { auditTrackedFiles };
