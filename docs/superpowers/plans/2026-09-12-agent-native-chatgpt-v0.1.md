# Agent-native ChatGPT Organizer v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the verified personal ChatGPT organizer scripts into a safe, configurable, agent-native v0.1 repository that strangers can use with their own Codex or Claude Code session.

**Architecture:** The user's coding agent performs semantic taxonomy and classification work, while CommonJS Node.js modules enforce deterministic local storage, schemas, workflow state, browser operations, audit, and approval gates. ChatGPT-specific browser behavior sits behind one adapter; all user-derived data lives under `.local/`, and the public repository contains only synthetic fixtures.

**Tech Stack:** Node.js 20+, CommonJS, Playwright, Ajv JSON Schema validation, `yaml`, Node's built-in `node:test`, static HTML reports, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-12-agent-native-chatgpt-v0.1-design.md`

## Global Constraints

- Version 0.1 supports ChatGPT Web on macOS with Google Chrome only.
- ChatGPT is the only verified provider; do not claim Claude, Gemini, or other provider support.
- The user's Codex or Claude Code account supplies semantic reasoning; the repository supplies no hosted AI service and no maintainer-owned API key.
- `doctor` and `plan` are read-only.
- Creating Projects, moving chats, and archiving chats require explicit user approval.
- The first write run is limited to five actions and must be verified before full apply.
- Deleting chats or Projects is permanently unsupported and must not exist in public interfaces.
- A rate-limit, access-restriction, account mismatch, selector mismatch, changed plan hash, or uncertain write result stops execution.
- Rate-limited writes are never retried automatically.
- All real browser profiles, cookies, conversations, classifications, plans, reports, audit events, logs, screenshots, and account identifiers remain under `.local/` or a legacy ignored path.
- Existing verified ChatGPT behavior must be preserved until its replacement passes equivalent tests and a manual read-only smoke test.
- Do not add a GUI, browser extension, multi-provider framework, vector database, knowledge graph, or telemetry in v0.1.

---

## Planned File Structure

### Files created

```text
AGENTS.md                                  Repository-wide safety contract for Codex and other agents
CLAUDE.md                                  Claude Code compatibility entry point
PRIVACY.md                                 Local data-flow and retention disclosure
SECURITY.md                                Vulnerability reporting and credential-handling rules
CONTRIBUTING.md                            Safe contribution and testing workflow
LICENSE                                    MIT license for the public repository
config/organizer.example.yaml              Generic, non-personal configuration example
schemas/taxonomy.schema.json               Taxonomy artifact contract
schemas/classifications.schema.json        Agent classification artifact contract
schemas/migration-plan.schema.json         Executable plan artifact contract
src/cli.js                                 Single user-facing command dispatcher
src/core/paths.js                          Workspace and `.local/` path construction and containment
src/core/config.js                         YAML configuration loading and defaults
src/core/validate.js                       Ajv schema loading and validation
src/core/state.js                          Workflow states, transitions, and persisted run state
src/core/planner.js                        Classification input and migration-plan construction
src/core/audit.js                          Append-only JSONL audit writer
src/core/apply-engine.js                   Approval, pilot, stop, resume, and idempotency enforcement
src/commands/doctor.js                     Environment and repository safety checks
src/commands/plan.js                       Read-only planning command orchestration
src/commands/apply.js                      Write command orchestration
src/commands/verify.js                     Post-action and run-summary verification
src/commands/clean-data.js                 Contained local-data cleanup
src/providers/chatgpt/selectors.js          Centralized ChatGPT selectors and visible-text patterns
src/providers/chatgpt/browser.js            Dedicated persistent browser lifecycle
src/providers/chatgpt/normalize.js          API and DOM result normalization
src/providers/chatgpt/adapter.js            Verified ChatGPT read/write adapter
src/reports/review.js                       Escaped static HTML review report generator
scripts/privacy-audit.js                    Tracked-file privacy and secret-pattern audit
.agents/skills/chatgpt-organizer/SKILL.md   Codex repository skill entry point
.claude/skills/chatgpt-organizer/SKILL.md   Claude Code repository skill entry point
tests/fixtures/conversations.json           Synthetic conversation fixture
tests/fixtures/classifications.json         Synthetic classification fixture
tests/fixtures/taxonomy.yaml                Synthetic taxonomy fixture
tests/helpers/fake-chatgpt-adapter.js        Deterministic adapter for apply tests
tests/paths.test.js                         Local-path containment tests
tests/privacy-audit.test.js                 Forbidden tracked-file tests
tests/config.test.js                        YAML/default behavior tests
tests/validate.test.js                      Schema contract tests
tests/state.test.js                         Workflow-transition tests
tests/repo-contract.test.js                 Agent-entry-point contract tests
tests/doctor.test.js                        Environment-check tests
tests/chatgpt-normalize.test.js             Read normalization and deduplication tests
tests/planner.test.js                       Threshold and archive-separation tests
tests/report.test.js                        HTML escaping and section tests
tests/apply-engine.test.js                  Pilot, approval, stop, and resume tests
tests/chatgpt-adapter.test.js               Selector and write-verification tests
tests/clean-data.test.js                    Cleanup containment tests
```

### Existing files modified

```text
.gitignore                                  Ignore `.local/` and every legacy private artifact
package.json                                Add CLI, tests, engines, and required dependencies
pnpm-lock.yaml                              Lock Ajv and YAML dependencies
README.md                                   Replace personal status with public quickstart and limits
scripts/01-discover.js                      Thin compatibility wrapper around the new CLI/adapter
scripts/02-login.js                         Thin compatibility wrapper around the new CLI/adapter
scripts/04-read.js                          Thin compatibility wrapper around the new CLI/adapter
scripts/05-analyze.js                       Thin compatibility wrapper around the new planner
scripts/07-create-projects.js               Retired from public entry points after adapter parity
scripts/08-phase2-move.js                   Retired from public entry points after apply-engine parity
scripts/09-phase2-archive.js                Retired from public entry points after apply-engine parity
scripts/10-phase2-archive-auto.js           Excluded from the public release; behavior contradicts safety policy
scripts/lib/browser.js                      Compatibility export backed by the new browser module
```

### Existing private files never staged

```text
AGENT.md
PROJECT_MAP.md
data/
profile/
chrome-profile/
logs/
migration-plan.json
progress.json
review.md
stats.md
```

---

### Task 1: Establish the private-data boundary, test harness, and initial Git baseline

**Files:**
- Modify: `.gitignore:1-16`
- Modify: `package.json:1-13`
- Create: `src/core/paths.js`
- Create: `scripts/privacy-audit.js`
- Create: `tests/paths.test.js`
- Create: `tests/privacy-audit.test.js`

**Interfaces:**
- Produces: `createPaths(rootDir): Paths`, `assertInsideLocal(paths, targetPath): string`, and `auditTrackedFiles(files): Finding[]`.
- `Paths` contains `root`, `local`, `profile`, `state`, `raw`, `plans`, `reports`, `audit`, and `logs`, all as absolute paths.
- Later tasks must use `createPaths()` instead of constructing user-data paths independently.

- [ ] **Step 1: Write failing path-containment tests**

```js
// tests/paths.test.js
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
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

Run: `node --test tests/paths.test.js`  
Expected: FAIL with `Cannot find module '../src/core/paths'`.

- [ ] **Step 3: Implement contained path construction**

```js
// src/core/paths.js
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
```

- [ ] **Step 4: Write failing privacy-audit tests**

```js
// tests/privacy-audit.test.js
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
```

- [ ] **Step 5: Implement the tracked-file audit**

```js
// scripts/privacy-audit.js
const { execFileSync } = require("node:child_process");

const forbidden = [
  /^\.local\//,
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
```

- [ ] **Step 6: Expand `.gitignore` before initializing Git**

Replace it with rules that include:

```gitignore
.local/
data/
profile/
chrome-profile/
logs/
node_modules/
migration-plan.json
progress.json
review.md
stats.md
AGENT.md
PROJECT_MAP.md
*.png
*.tmp
.DS_Store
scripts/03-list-api.js
scripts/06-pilot-phase2.js
scripts/07-summarize.js
scripts/10-phase2-archive-auto.js
scripts/classify-all.js
scripts/classify-override.js
scripts/diag-*.js
```

- [ ] **Step 7: Add the test and CLI scripts to `package.json`**

Set the following exact fields while preserving Playwright:

```json
{
  "name": "chatgpt-organizer",
  "version": "0.1.0",
  "private": true,
  "description": "Agent-native organizer for ChatGPT conversation history",
  "engines": { "node": ">=20" },
  "scripts": {
    "login": "node scripts/02-login.js",
    "discover": "node scripts/01-discover.js",
    "test": "node --test",
    "privacy:audit": "node scripts/privacy-audit.js"
  },
  "dependencies": {
    "playwright": "^1.62.1"
  }
}
```

- [ ] **Step 8: Run the foundation tests**

Run: `pnpm test`  
Expected: four tests PASS.

- [ ] **Step 9: Initialize Git only after ignore rules exist, then audit the staged candidate list**

Run:

```bash
git init
git status --short --ignored
git add .gitignore package.json src/core/paths.js scripts/privacy-audit.js scripts/01-discover.js scripts/02-login.js scripts/04-read.js scripts/lib/browser.js tests/paths.test.js tests/privacy-audit.test.js
pnpm privacy:audit
git diff --cached --name-only
```

Expected: the privacy audit exits 0; no path from the private-files list appears in the staged list.
The four verified read-side legacy files are intentionally captured in this
baseline so Task 5 has a reviewable diff and can be reverted if its manual
read-only parity check fails.

- [ ] **Step 10: Commit the safe foundation**

```bash
git commit -m "chore: establish private data boundary"
```

---

### Task 2: Add configuration, schemas, validation, and workflow state

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `config/organizer.example.yaml`
- Create: `schemas/taxonomy.schema.json`
- Create: `schemas/classifications.schema.json`
- Create: `schemas/migration-plan.schema.json`
- Create: `src/core/config.js`
- Create: `src/core/validate.js`
- Create: `src/core/state.js`
- Create: `tests/fixtures/taxonomy.yaml`
- Create: `tests/fixtures/classifications.json`
- Create: `tests/config.test.js`
- Create: `tests/validate.test.js`
- Create: `tests/state.test.js`

**Interfaces:**
- Consumes: `createPaths(rootDir)` from Task 1.
- Produces: `loadConfig(filePath): OrganizerConfig`, `validateTaxonomy(value)`, `validateClassifications(value)`, `validateMigrationPlan(value)`, `loadRunState(paths)`, `saveRunState(paths, state)`, and `transitionState(state, next)`.
- `transitionState` accepts only the ordered states defined in the approved spec and rejects skipped approval gates.

- [ ] **Step 1: Install only the two required parsing/validation dependencies**

Run: `pnpm add ajv yaml`  
Expected: `package.json` and `pnpm-lock.yaml` add Ajv and YAML; no other production dependency is added.

- [ ] **Step 2: Write configuration and validation tests**

```js
// tests/config.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadConfig } = require("../src/core/config");

test("loads the synthetic taxonomy and safe action defaults", () => {
  const config = loadConfig(path.join(__dirname, "fixtures/taxonomy.yaml"));
  assert.equal(config.classification.moveThreshold, 0.95);
  assert.equal(config.actions.allowMove, false);
  assert.equal(config.actions.allowArchive, false);
  assert.equal(config.actions.neverDelete, true);
  assert.deepEqual(config.taxonomy.projects.map((p) => p.name), ["Work", "Learning"]);
});
```

```js
// tests/validate.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { validateClassifications } = require("../src/core/validate");

test("rejects confidence outside zero to one", () => {
  assert.throws(() => validateClassifications([{
    conversationId: "fixture-chat-1",
    project: "Work",
    confidence: 1.2,
    reason: "Synthetic reason",
    suggestedAction: "move"
  }]), /confidence/);
});
```

- [ ] **Step 3: Create the generic safe configuration**

```yaml
# config/organizer.example.yaml and tests/fixtures/taxonomy.yaml
provider: chatgpt
classification:
  moveThreshold: 0.95
  fullContentBelow: 0.90
actions:
  allowCreateProjects: false
  allowMove: false
  allowArchive: false
  neverDelete: true
taxonomy:
  projects:
    - name: Work
      description: Ongoing professional work and decisions.
      include: []
      exclude: []
    - name: Learning
      description: Research, study, and reusable explanations.
      include: []
      exclude: []
```

- [ ] **Step 4: Define complete JSON Schemas**

The taxonomy schema requires unique Project names plus non-empty `name` and
`description`. The classification schema requires `conversationId`, nullable
`project`, `confidence` from 0 through 1, non-empty `reason`, and one of
`move`, `archive`, or `keep`. The migration-plan schema requires the same
classification fields plus `title`, `url`, `currentProject`, and `status`, as
well as a `projects` list containing each proposed Project name, whether it
already exists, whether creation is required, and the proposed conversation
count.
Authorization is deliberately not stored as an item field: the user's exact
plan hash authorizes the immutable plan as a whole. Any requested item change
regenerates both the plan and its hash and therefore requires fresh approval.

Use `additionalProperties: false` at every object boundary so misspelled action
fields fail closed.

- [ ] **Step 5: Implement YAML defaults and Ajv validators**

```js
// src/core/config.js
const fs = require("node:fs");
const YAML = require("yaml");

function loadConfig(filePath) {
  const value = YAML.parse(fs.readFileSync(filePath, "utf8"));
  return {
    provider: value.provider || "chatgpt",
    classification: {
      moveThreshold: value.classification?.moveThreshold ?? 0.95,
      fullContentBelow: value.classification?.fullContentBelow ?? 0.90,
    },
    actions: {
      allowCreateProjects: value.actions?.allowCreateProjects === true,
      allowMove: value.actions?.allowMove === true,
      allowArchive: value.actions?.allowArchive === true,
      neverDelete: true,
    },
    taxonomy: value.taxonomy,
  };
}

module.exports = { loadConfig };
```

`src/core/validate.js` loads each schema once, compiles it with Ajv using
`allErrors: true`, and throws concrete errors such as
`Invalid classifications: /0/confidence must be <= 1`.

- [ ] **Step 6: Write failing workflow-transition tests**

```js
// tests/state.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunState, transitionState } = require("../src/core/state");

test("cannot skip plan review and pilot approval", () => {
  const state = createRunState("run-fixture", "account-fixture");
  state.phase = "CLASSIFY";
  assert.throws(() => transitionState(state, "PILOT"), /Invalid transition/);
});

test("allows the approved path into the pilot", () => {
  const state = createRunState("run-fixture", "account-fixture");
  for (const phase of [
    "AUTHENTICATE", "DISCOVER", "TAXONOMY_REVIEW", "CLASSIFY",
    "PLAN_REVIEW", "PILOT_APPROVAL", "PILOT"
  ]) transitionState(state, phase);
  assert.equal(state.phase, "PILOT");
});
```

- [ ] **Step 7: Implement persisted workflow state**

`src/core/state.js` defines the exact transition map:

```js
const transitions = {
  PREFLIGHT: ["AUTHENTICATE"],
  AUTHENTICATE: ["DISCOVER"],
  DISCOVER: ["TAXONOMY_REVIEW"],
  TAXONOMY_REVIEW: ["CLASSIFY"],
  CLASSIFY: ["PLAN_REVIEW"],
  PLAN_REVIEW: ["PILOT_APPROVAL"],
  PILOT_APPROVAL: ["PILOT"],
  PILOT: ["APPLY_APPROVAL"],
  APPLY_APPROVAL: ["APPLY"],
  APPLY: ["VERIFY"],
  VERIFY: ["COMPLETE"],
  COMPLETE: [],
};
```

Persist state atomically by writing `run.json.tmp` and renaming it to
`run.json`. Create the state directory with mode `0o700` and state files with
mode `0o600`.

- [ ] **Step 8: Run the contract tests**

Run: `pnpm test`  
Expected: all configuration, validation, state, path, and privacy tests PASS.

- [ ] **Step 9: Commit the contracts**

```bash
git add package.json pnpm-lock.yaml config schemas src/core/config.js src/core/validate.js src/core/state.js tests/config.test.js tests/validate.test.js tests/state.test.js tests/fixtures/taxonomy.yaml tests/fixtures/classifications.json
git commit -m "feat: add organizer configuration and workflow contracts"
```

---

### Task 3: Add agent-native instruction and skill entry points

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Create: `.agents/skills/chatgpt-organizer/SKILL.md`
- Create: `.claude/skills/chatgpt-organizer/SKILL.md`
- Create: `docs/workflow.md`
- Create: `docs/safety.md`
- Create: `tests/repo-contract.test.js`

**Interfaces:**
- Consumes: command names, phases, and safety behavior from Tasks 1–2.
- Produces: auto-discoverable instructions for Codex and Claude Code that route both agents to the same workflow and scripts.

- [ ] **Step 1: Write the failing repository-contract test**

```js
// tests/repo-contract.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("agent entry points share the same safety contract", () => {
  const agents = fs.readFileSync("AGENTS.md", "utf8");
  const claude = fs.readFileSync("CLAUDE.md", "utf8");
  const codexSkill = fs.readFileSync(".agents/skills/chatgpt-organizer/SKILL.md", "utf8");
  const claudeSkill = fs.readFileSync(".claude/skills/chatgpt-organizer/SKILL.md", "utf8");
  assert.match(agents, /read-only by default/i);
  assert.match(agents, /never delete/i);
  assert.match(claude, /AGENTS\.md/);
  assert.match(codexSkill, /docs\/workflow\.md/);
  assert.match(claudeSkill, /docs\/workflow\.md/);
});
```

- [ ] **Step 2: Run the test and confirm the files are missing**

Run: `node --test tests/repo-contract.test.js`  
Expected: FAIL with `ENOENT` for `AGENTS.md`.

- [ ] **Step 3: Create the root safety contract**

`AGENTS.md` must include these exact operational rules:

```markdown
# ChatGPT Organizer Agent Contract

- Read-only by default: `doctor` and `plan` may run without write approval.
- Never delete a conversation or Project. No exception is supported.
- Do not create Projects, move chats, or archive chats until the user approves the generated plan.
- The first approved write run is a maximum five-item pilot.
- Stop on rate limits, access restrictions, account mismatch, missing selectors, changed plan hash, or uncertain verification.
- Never improvise browser clicks. Use only repository commands and the ChatGPT adapter.
- Never stage `.local/`, legacy data, profiles, logs, screenshots, plans, or conversation identifiers.
- Read `docs/workflow.md` and `docs/safety.md` before operating on a user's account.
```

- [ ] **Step 4: Create the Claude compatibility entry point**

```markdown
# Claude Code Entry Point

Read and follow `AGENTS.md` before doing any work in this repository.
For ChatGPT history organization, load `.claude/skills/chatgpt-organizer/SKILL.md`.
The safety rules in `AGENTS.md` override convenience and speed.
```

- [ ] **Step 5: Create equivalent repository skills**

Each `SKILL.md` uses the name `chatgpt-organizer`, triggers on requests to
organize, classify, move, archive, or review ChatGPT history, reads
`docs/workflow.md` and `docs/safety.md`, and follows these stages:

```markdown
1. Run `pnpm organizer doctor` and report failures.
2. Use `pnpm organizer login` only when authentication is required.
3. Run `pnpm organizer plan`; keep all actions read-only.
4. Ask the user to approve the taxonomy and migration report.
5. After explicit approval, run a maximum five-action pilot.
6. Verify the pilot and report results before requesting full-apply approval.
7. Resume approved actions in batches and stop on any safety condition.
8. Run `pnpm organizer verify` and offer `pnpm organizer clean:data`.
```

- [ ] **Step 6: Document the state machine and authorization language**

`docs/workflow.md` lists every phase from `PREFLIGHT` through `COMPLETE`, the
command that advances it, the artifact produced, and the exact approval needed.
`docs/safety.md` explains local data, dedicated profiles, unsupported deletes,
rate limits, unofficial browser automation, and bug-report redaction.

- [ ] **Step 7: Run the repository-contract and complete test suite**

Run: `pnpm test`  
Expected: all tests PASS.

- [ ] **Step 8: Commit the agent entry points**

```bash
git add AGENTS.md CLAUDE.md .agents/skills/chatgpt-organizer/SKILL.md .claude/skills/chatgpt-organizer/SKILL.md docs/workflow.md docs/safety.md docs/superpowers/specs/2026-09-12-agent-native-chatgpt-v0.1-design.md docs/superpowers/plans/2026-09-12-agent-native-chatgpt-v0.1.md tests/repo-contract.test.js
git commit -m "feat: add agent-native organizer workflow"
```

---

### Task 4: Implement the CLI dispatcher and environment doctor

**Files:**
- Create: `src/cli.js`
- Create: `src/commands/doctor.js`
- Create: `tests/doctor.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createPaths()`, `loadConfig()`, and validation contracts.
- Produces: `main(argv, deps): Promise<number>` and `runDoctor(deps): Promise<Check[]>`.
- A `Check` is `{ name: string, status: "ok" | "warn" | "fail", message: string }`.

- [ ] **Step 1: Write failing doctor tests with injected dependencies**

```js
// tests/doctor.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { runDoctor } = require("../src/commands/doctor");

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
```

- [ ] **Step 2: Implement deterministic environment checks**

`runDoctor()` checks Node major version, platform, the configured Chrome
executable, `.local/` path containment, ignore coverage, configuration
parseability, and writable local directories. Browser login and selector
checks are opt-in through `doctor --browser` because opening a browser is more
expensive than static preflight.

- [ ] **Step 3: Implement an allowlisted CLI dispatcher**

```js
#!/usr/bin/env node
// src/cli.js
const commands = new Map([
  ["doctor", () => require("./commands/doctor")],
  ["plan", () => require("./commands/plan")],
  ["apply", () => require("./commands/apply")],
  ["verify", () => require("./commands/verify")],
  ["clean:data", () => require("./commands/clean-data")],
]);

async function main(argv = process.argv.slice(2)) {
  const name = argv[0];
  if (!commands.has(name)) {
    process.stderr.write("Usage: pnpm organizer <doctor|plan|apply|verify|clean:data>\n");
    return 2;
  }
  return commands.get(name)().run(argv.slice(1));
}

if (require.main === module) main().then((code) => { process.exitCode = code; });
module.exports = { main };
```

Add `"organizer": "node src/cli.js"` to `package.json` in this task.
Add a temporary explicit `login` entry when Task 5 creates that command; until
then, the usage output must not advertise an unavailable command.

- [ ] **Step 4: Test success and failure output**

Add CLI tests that inject a doctor implementation, assert exit 0 when no check
fails, assert exit 1 when a check fails, and assert exit 2 for an unknown
command.

- [ ] **Step 5: Run tests and static doctor**

Run:

```bash
pnpm test
pnpm organizer doctor
```

Expected: tests PASS; local doctor reports macOS, Node, Chrome, paths, ignore
coverage, and config without reading ChatGPT.

- [ ] **Step 6: Commit the CLI foundation**

```bash
git add src/cli.js src/commands/doctor.js tests/doctor.test.js package.json
git commit -m "feat: add organizer CLI and environment doctor"
```

---

### Task 5: Refactor verified ChatGPT discovery and reading behind an adapter

**Files:**
- Create: `src/providers/chatgpt/selectors.js`
- Create: `src/providers/chatgpt/browser.js`
- Create: `src/providers/chatgpt/normalize.js`
- Create: `src/providers/chatgpt/adapter.js`
- Create: `tests/fixtures/conversations.json`
- Create: `tests/chatgpt-normalize.test.js`
- Modify: `scripts/lib/browser.js:1-78`
- Modify: `scripts/01-discover.js:1-130`
- Modify: `scripts/02-login.js:1-117`
- Modify: `scripts/04-read.js:1-190`
- Modify: `src/cli.js`

**Interfaces:**
- Consumes: `Paths` from Task 1.
- Produces: `ChatGPTAdapter` with `login()`, `discoverConversations()`, `readConversation(id)`, and `getAccountFingerprint()` in this task.
- Later tasks add write methods to the same class without changing read signatures.

- [ ] **Step 1: Write normalization and deduplication tests**

```js
// tests/chatgpt-normalize.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeApiConversation, mergeConversations } = require("../src/providers/chatgpt/normalize");

test("normalizes ChatGPT list items without message content", () => {
  assert.deepEqual(normalizeApiConversation({
    id: "fixture-chat-1",
    title: "Synthetic planning chat",
    create_time: 1700000000,
    update_time: 1700000100,
  }), {
    provider: "chatgpt",
    conversationId: "fixture-chat-1",
    title: "Synthetic planning chat",
    createdAt: 1700000000,
    updatedAt: 1700000100,
    currentProject: null,
    url: "https://chatgpt.com/c/fixture-chat-1",
  });
});

test("deduplicates by provider and conversation ID", () => {
  const first = normalizeApiConversation({ id: "fixture-chat-1", title: "Old", update_time: 1 });
  const latest = normalizeApiConversation({ id: "fixture-chat-1", title: "New", update_time: 2 });
  assert.deepEqual(mergeConversations([first, latest]).map((c) => c.title), ["New"]);
});
```

- [ ] **Step 2: Centralize bilingual selectors and safety patterns**

`selectors.js` exports selectors for history navigation, conversation links,
message roles, the header options button, open menus, Project creation fields,
and visible-text patterns for login, move, archive, and rate-limit detection.
It exports no delete selector or delete text pattern.

- [ ] **Step 3: Move the browser profile to `.local/profile`**

`src/providers/chatgpt/browser.js` reuses the persistent-context behavior from
`scripts/lib/browser.js`, but receives `paths.profile` and a configurable Chrome
executable. It never accepts the user's default Chrome data directory.

- [ ] **Step 4: Implement the read side of `ChatGPTAdapter`**

Move the verified response-listening, wheel-scrolling, full-ID navigation, DOM
message extraction, checkpointing, and resume behavior from the numbered
scripts into class methods. Persist normalized list data under
`.local/raw/conversations.json` and individual conversations under
`.local/raw/conversations/{conversationId}.json`.

`getAccountFingerprint()` hashes stable, non-secret account context with SHA-256
and stores only the first 16 hexadecimal characters; it never stores an email,
cookie, access token, or full session response.

- [ ] **Step 5: Convert numbered read scripts to compatibility wrappers**

Each wrapper prints a deprecation message and delegates to the corresponding
adapter/CLI command. Remove direct root-level writes from all three wrappers.
Do not delete the original behavior until the adapter passes the read-only
manual smoke test.

- [ ] **Step 6: Add `login` and `discover` to the internal CLI command map**

The README primary flow continues to advertise `doctor` and `plan`; the agent
skill may call `login` and `discover` as necessary. Both commands are read-only
with respect to ChatGPT content, though `login` writes local browser state.

- [ ] **Step 7: Run automated normalization tests**

Run: `pnpm test`  
Expected: all tests PASS without launching Chrome.

- [ ] **Step 8: Run a manual read-only smoke test using the existing account**

Run:

```bash
pnpm organizer doctor --browser
pnpm organizer discover --max 5
```

Expected: the dedicated browser opens, the account is recognized, five or
fewer normalized synthetic-free local records are written only under
`.local/raw`, and no ChatGPT Project, chat location, archive state, title, or
message is changed.

- [ ] **Step 9: Commit the read adapter**

```bash
git add src/providers/chatgpt src/cli.js scripts/lib/browser.js scripts/01-discover.js scripts/02-login.js scripts/04-read.js tests/chatgpt-normalize.test.js tests/fixtures/conversations.json
git commit -m "refactor: isolate verified ChatGPT read adapter"
```

---

### Task 6: Implement configurable planning and agent-produced classifications

**Files:**
- Create: `src/core/planner.js`
- Create: `src/commands/plan.js`
- Create: `tests/planner.test.js`
- Modify: `scripts/05-analyze.js:1-106`
- Modify: `.agents/skills/chatgpt-organizer/SKILL.md`
- Modify: `.claude/skills/chatgpt-organizer/SKILL.md`

**Interfaces:**
- Consumes: normalized conversations, optional extracted messages, `OrganizerConfig`, and schema-validated agent classifications.
- Produces: `buildClassificationInput(conversations, extracted, config)`, `buildMigrationPlan(conversations, classifications, config)`, and `hashPlan(plan)`.
- `plan` writes `.local/plans/classification-input.jsonl`, `.local/plans/classifications.json`, and `.local/plans/migration-plan.json`.

- [ ] **Step 1: Write failing planner policy tests**

```js
// tests/planner.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMigrationPlan } = require("../src/core/planner");

const conversations = [{
  provider: "chatgpt",
  conversationId: "fixture-chat-1",
  title: "Synthetic chat",
  currentProject: null,
  url: "https://chatgpt.com/c/fixture-chat-1",
}];

test("confidence below threshold stays unresolved and is not archived", () => {
  const plan = buildMigrationPlan(conversations, [{
    conversationId: "fixture-chat-1",
    project: "Work",
    confidence: 0.94,
    reason: "Possible work topic",
    suggestedAction: "move",
  }], { classification: { moveThreshold: 0.95 } });
  assert.equal(plan.items[0].status, "unresolved");
  assert.equal(plan.items[0].action, "keep");
});

test("archive requires an independent archive reason", () => {
  assert.throws(() => buildMigrationPlan(conversations, [{
    conversationId: "fixture-chat-1",
    project: null,
    confidence: 0.80,
    reason: "No matching project",
    suggestedAction: "archive",
  }], { classification: { moveThreshold: 0.95 } }), /archive reason/);
});
```

- [ ] **Step 2: Implement progressive classification input**

For every conversation, include title, created/updated timestamps, first user
message, and last user message. Include additional excerpts only when the
classification artifact records a confidence below `fullContentBelow` and the
user has allowed full-content review.

Truncate each excerpt by Unicode code points, not raw bytes, and preserve the
private conversation ID only in `.local/` artifacts.

- [ ] **Step 3: Implement fail-closed plan construction**

`buildMigrationPlan()` joins by exact `conversationId`, rejects duplicate or
unknown classifications, applies the configured threshold, converts low-
confidence moves to `keep`, requires a separate `archiveReason` for archive,
validates the result, and returns:

```js
{
  provider: "chatgpt",
  generatedAt: "2026-09-12T00:00:00.000Z",
  taxonomyHash: "sha256-hex",
  projects: [{
    name: "Work",
    exists: false,
    createRequired: true,
    proposedConversationCount: 1
  }],
  items: [],
  planHash: "sha256-hex"
}
```

Tests inject the clock so timestamps are deterministic.

- [ ] **Step 4: Implement the `plan` command phases**

- With no taxonomy, copy the generic example to `.local/plans/taxonomy.yaml`
  and return a message asking the agent and user to customize it.
- With an approved taxonomy but no classifications, write
  `classification-input.jsonl` and return a message asking the coding agent to
  produce schema-valid `classifications.json`.
- With both artifacts present, validate them, build `migration-plan.json`, and
  advance the run to `PLAN_REVIEW`.
- Never enable an action flag or advance to `PILOT_APPROVAL` automatically.

- [ ] **Step 5: Update both skills with the exact classification contract**

The skill instructs the agent to process the input in bounded batches, write
only schema-valid classifications, never classify unresolved as archive, and
show taxonomy samples/counts before marking the taxonomy reviewed.

- [ ] **Step 6: Convert `05-analyze.js` to a planner compatibility wrapper**

It delegates to `pnpm organizer plan` behavior and never reads or writes the
legacy root-level `migration-plan.json`, `review.md`, or `stats.md`.

- [ ] **Step 7: Run planner tests**

Run: `pnpm test`  
Expected: threshold, archive separation, duplicate-ID, unknown-ID, schema, and
deterministic-hash tests PASS.

- [ ] **Step 8: Commit the planner**

```bash
git add src/core/planner.js src/commands/plan.js scripts/05-analyze.js .agents/skills/chatgpt-organizer/SKILL.md .claude/skills/chatgpt-organizer/SKILL.md tests/planner.test.js
git commit -m "feat: generate safe configurable migration plans"
```

---

### Task 7: Generate a local review report

**Files:**
- Create: `src/reports/review.js`
- Create: `tests/report.test.js`
- Modify: `src/commands/plan.js`

**Interfaces:**
- Consumes: a validated migration plan and taxonomy.
- Produces: `renderReviewHtml({ plan, taxonomy }): string` and writes `.local/reports/review.html`.

- [ ] **Step 1: Write failing HTML escaping and section tests**

```js
// tests/report.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { renderReviewHtml } = require("../src/reports/review");

test("escapes private conversation text and shows review buckets", () => {
  const html = renderReviewHtml({
    taxonomy: { projects: [{ name: "Work", description: "Work items" }] },
    plan: {
      planHash: "fixture-hash",
      items: [{
        conversationId: "fixture-chat-1",
        title: "<script>alert(1)</script>",
        project: "Work",
        confidence: 0.97,
        reason: "Synthetic reason",
        action: "move",
        status: "proposed",
      }],
    },
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Proposed moves/);
  assert.match(html, /Unresolved/);
  assert.match(html, /Archive candidates/);
});
```

- [ ] **Step 2: Implement a dependency-free static report**

Create one HTML file with embedded CSS and JavaScript. It shows aggregate
counts, Project counts, proposed moves, unresolved items, archive candidates,
confidence, current and proposed locations, reasons, every Project that would
be created, and the plan hash. Client-
side filters operate only on data already embedded in the local file.

Escape `&`, `<`, `>`, `"`, and `'` before inserting any title, Project,
reason, or URL. Do not load fonts, analytics, scripts, images, or styles from
the network.

- [ ] **Step 3: Generate the report at the end of `plan`**

After schema validation and plan hashing, write the report under
`.local/reports/review.html`, print its absolute path, and state that no
ChatGPT changes have been made.

- [ ] **Step 4: Run report and planner tests**

Run: `pnpm test`  
Expected: escaping, bucket, aggregate-count, and deterministic-plan tests PASS.

- [ ] **Step 5: Commit the report generator**

```bash
git add src/reports/review.js src/commands/plan.js tests/report.test.js
git commit -m "feat: add local migration review report"
```

---

### Task 8: Implement approval hashing, pilot limits, audit, stop behavior, and resume

**Files:**
- Create: `src/core/audit.js`
- Create: `src/core/apply-engine.js`
- Create: `src/commands/apply.js`
- Create: `tests/helpers/fake-chatgpt-adapter.js`
- Create: `tests/apply-engine.test.js`

**Interfaces:**
- Consumes: validated plan, persisted state, approval hash, `ChatGPTAdapter`, and paths.
- Consumes: the single canonical `hashPlan(plan)` exported by `src/core/planner.js`.
- Produces: `appendAudit(paths, event)` and `runApply({ plan, state, adapter, approvalHash, mode, maxActions }): ApplyResult`.
- `ApplyResult` is `{ completed, failed, skipped, uncertain, stoppedReason }`.

- [ ] **Step 1: Create the fake adapter and failing pilot test**

```js
// tests/helpers/fake-chatgpt-adapter.js
class FakeChatGPTAdapter {
  constructor() {
    this.actions = [];
    this.accountFingerprint = "account-fixture";
  }
  async getAccountFingerprint() { return this.accountFingerprint; }
  async createProject(name) { this.actions.push(["createProject", name]); return { status: "verified" }; }
  async moveConversation(id, project) { this.actions.push(["move", id, project]); return { status: "verified" }; }
  async archiveConversation(id) { this.actions.push(["archive", id]); return { status: "verified" }; }
  async verifyConversationLocation() { return { status: "verified" }; }
}
module.exports = { FakeChatGPTAdapter };
```

```js
// tests/apply-engine.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPlan } = require("../src/core/planner");
const { runApply } = require("../src/core/apply-engine");
const { FakeChatGPTAdapter } = require("./helpers/fake-chatgpt-adapter");

test("pilot never executes more than five plan-hash-approved actions", async () => {
  const adapter = new FakeChatGPTAdapter();
  const plan = {
    provider: "chatgpt",
    items: Array.from({ length: 7 }, (_, index) => ({
      conversationId: `fixture-${index}`,
      action: "move",
      project: "Work",
      status: "pending",
    })),
  };
  const approvalHash = hashPlan(plan);
  const result = await runApply({
    plan,
    state: { phase: "PILOT", accountFingerprint: "account-fixture" },
    adapter,
    approvalHash,
    mode: "pilot",
    maxActions: 99,
    appendAudit: async () => {},
  });
  assert.equal(result.completed, 5);
  assert.equal(adapter.actions.length, 5);
});
```

- [ ] **Step 2: Write changed-plan, account, and stop-condition tests**

Add tests asserting:

- A non-matching approval hash performs zero actions.
- A non-matching account fingerprint performs zero actions.
- An adapter result of `rate_limited` stops immediately and is not retried.
- An adapter result of `uncertain` stops immediately.
- A previously `done` item is skipped during resume.
- A `keep` item is skipped.
- No action other than `move`, `archive`, and required `createProject` is accepted.
- A required Project creation is executed only when it appears in
  `plan.projects`, and it counts toward the five-action pilot cap.
- Pilot approval moves state from `PLAN_REVIEW` through `PILOT_APPROVAL` to
  `PILOT`; full approval moves verified state from `APPLY_APPROVAL` to `APPLY`.
- Malformed approval input never constructs or opens the browser adapter.

- [ ] **Step 3: Implement canonical plan hashing**

Clone the plan, remove the root `planHash` field, sort all remaining object keys
recursively, preserve array order, serialize with `JSON.stringify`, and hash
with SHA-256. No second hashing implementation is allowed. The approval hash
shown in the report and supplied to apply must use this same function.

- [ ] **Step 4: Implement append-only audit writes**

`appendAudit()` creates `.local/audit` with mode `0o700`, appends one JSON event
per line to `events.jsonl` with mode `0o600`, calls `fsyncSync()` before
returning, and never writes message content, titles, cookies, or account data.

- [ ] **Step 5: Implement the fail-closed apply engine**

The engine validates phase, provider, plan hash, account fingerprint, and the
action allowlist before doing work. Supplying the exact hash explicitly
authorizes the complete immutable plan; changing an item invalidates that
authorization. Explicit `projects[].createRequired` entries are processed as
actions and count toward the same cap. Pilot mode applies
`Math.min(maxActions, 5)`. It marks an item `running`, writes an audit event,
performs the adapter action, verifies it, then marks `done`. It stops on
`uncertain`, `rate_limited`, `access_restricted`, or `selector_missing`.

The engine never contains a loop that sleeps and retries rate-limited actions.

- [ ] **Step 6: Implement the apply command approval contract**

The command requires:

```bash
organizer_plan_hash="$(node -p 'require("./.local/plans/migration-plan.json").planHash')"
pnpm organizer apply --mode pilot --approve "$organizer_plan_hash"
pnpm organizer apply --mode resume --approve "$organizer_plan_hash"
```

It rejects missing or malformed hashes before opening Chrome. A valid pilot
invocation requires phase `PLAN_REVIEW`, persists the approved plan hash, and
transitions through `PILOT_APPROVAL` to `PILOT`. A valid full invocation
requires persisted successful pilot verification and phase `APPLY_APPROVAL`,
persists the full-apply approval, and transitions to `APPLY`. Unit tests inject
the adapter factory and prove that rejected approval never creates a browser.

- [ ] **Step 7: Run apply-engine tests**

Run: `pnpm test`  
Expected: pilot, hash, account, allowlist, stop, audit, and resume tests PASS
without launching Chrome.

- [ ] **Step 8: Commit the safe execution engine**

```bash
git add src/core/audit.js src/core/apply-engine.js src/commands/apply.js tests/helpers/fake-chatgpt-adapter.js tests/apply-engine.test.js
git commit -m "feat: enforce approval and pilot gates"
```

---

### Task 9: Move verified ChatGPT write behavior into the adapter and add verification

**Files:**
- Modify: `src/providers/chatgpt/adapter.js`
- Modify: `src/providers/chatgpt/selectors.js`
- Create: `src/commands/verify.js`
- Create: `tests/chatgpt-adapter.test.js`
- Modify: `scripts/07-create-projects.js:1-80`
- Modify: `scripts/08-phase2-move.js:1-130`
- Modify: `scripts/09-phase2-archive.js:1-100`
- Modify: `src/cli.js`

**Interfaces:**
- Consumes: the apply-engine adapter contract from Task 8.
- Produces: `createProject(name)`, `moveConversation(id, project)`, `archiveConversation(id)`, `verifyConversationLocation(id, expected)`, and `detectSafetyStop()`.
- Each write method returns `{ status: "verified" | "uncertain" | "rate_limited" | "access_restricted" | "selector_missing", evidence: string }`.

- [ ] **Step 1: Write selector and write-result tests with a fake page**

Tests provide a page double with controlled locator/evaluate results and assert:

- Exact Project-name matching is required.
- Missing or multiple matching menu items returns `selector_missing`.
- Move returns `verified` only after destination verification.
- Archive returns `verified` only after a reliable archived-state observation.
- Rate-limit text returns `rate_limited` before any click.
- The adapter module contains no exported or internal delete method.

- [ ] **Step 2: Implement centralized safety-stop detection**

Check visible page text and URL for rate limiting, temporary access restriction,
verification challenges, logout, and unexpected account/workspace changes.
Return a typed result; do not attempt navigation around those states.

- [ ] **Step 3: Refactor Project creation**

Reuse the verified Project-existence check and creation flow. Require exact
Project names from the validated taxonomy, check safety state before and after
the operation, and verify the Project appears in the sidebar before returning
`verified`.

- [ ] **Step 4: Refactor move and archive operations**

Reuse full conversation-ID navigation and the header options menu. Match only
the centralized move/archive patterns and exact destination Project. Remove all
code paths that could select a delete control. A missing confirmation or
observable final state returns `uncertain`, not success.

- [ ] **Step 5: Implement run verification**

`src/commands/verify.js` compares all `done` items against observable ChatGPT
state, writes verification audit events, advances a verified pilot to
`APPLY_APPROVAL`, and advances a verified full run to `COMPLETE`. Any mismatch
leaves the run incomplete and reports the exact local item IDs requiring manual
review.

- [ ] **Step 6: Retire unsafe direct entry points**

Convert create/move/archive numbered scripts to wrappers that refuse to run
unless the new validated plan, approval hash, and state gates are present.
Exclude `scripts/10-phase2-archive-auto.js` from the public staged files; retain
the local legacy file through `.gitignore` rather than deleting the user's copy.

- [ ] **Step 7: Run automated tests**

Run: `pnpm test`  
Expected: all adapter and apply tests PASS without a live account.

- [ ] **Step 8: Run a manually approved five-move pilot**

After reviewing the generated local report and confirming the plan hash, run:

```bash
organizer_plan_hash="$(node -p 'require("./.local/plans/migration-plan.json").planHash')"
pnpm organizer apply --mode pilot --approve "$organizer_plan_hash"
pnpm organizer verify
```

Expected: at most five moves occur, every move has a verification and audit
event, no archive occurs unless separately approved, and the run stops after
pilot verification at `APPLY_APPROVAL`.

- [ ] **Step 9: Commit the verified write adapter**

```bash
git add src/providers/chatgpt/adapter.js src/providers/chatgpt/selectors.js src/commands/verify.js src/cli.js scripts/07-create-projects.js scripts/08-phase2-move.js scripts/09-phase2-archive.js tests/chatgpt-adapter.test.js
git commit -m "refactor: gate ChatGPT writes behind verified adapter"
```

---

### Task 10: Add contained cleanup, public documentation, and release verification

**Files:**
- Create: `src/commands/clean-data.js`
- Create: `tests/clean-data.test.js`
- Create: `PRIVACY.md`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `LICENSE`
- Create: `docs/troubleshooting.md`
- Modify: `README.md:1-58`
- Modify: `AGENTS.md`
- Modify: `.agents/skills/chatgpt-organizer/SKILL.md`
- Modify: `.claude/skills/chatgpt-organizer/SKILL.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Paths`, workflow commands, and provider support status.
- Produces: `cleanData(paths, selections): string[]`, complete public onboarding, and the v0.1 release gate.

- [ ] **Step 1: Write failing cleanup-containment tests**

```js
// tests/clean-data.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createPaths } = require("../src/core/paths");
const { resolveCleanupTargets } = require("../src/commands/clean-data");

test("normal cleanup excludes the browser profile", () => {
  const paths = createPaths(path.resolve("/tmp/chatgpt-organizer-test"));
  const targets = resolveCleanupTargets(paths, { includeProfile: false });
  assert.equal(targets.includes(paths.profile), false);
  assert.deepEqual(targets, [paths.raw, paths.plans, paths.reports, paths.audit, paths.logs]);
});

test("profile cleanup is separately explicit", () => {
  const paths = createPaths(path.resolve("/tmp/chatgpt-organizer-test"));
  const targets = resolveCleanupTargets(paths, { includeProfile: true });
  assert.equal(targets.at(-1), paths.profile);
});
```

- [ ] **Step 2: Implement confirmed, contained cleanup**

`clean:data` prints every absolute target, requires the user to type the random
run ID, validates every target with `assertInsideLocal`, and then removes only
the listed directories. `--include-profile` adds a second confirmation that
states the user will need to log in again. Tests inject the confirmation reader
and filesystem removal function.

- [ ] **Step 3: Rewrite README around the agent-native flow**

The README order is:

1. One-sentence value proposition.
2. A sanitized before/after demo.
3. Verified-provider table showing ChatGPT only.
4. Read-only-by-default safety statement.
5. Requirements and installation.
6. Exact Codex and Claude Code first prompts.
7. Plan, pilot, apply, verify, and cleanup flow.
8. Local data map.
9. Limitations and unofficial-automation warning.
10. Troubleshooting, contributing, security, privacy, and license links.

It must not claim that the current personal 595-conversation dataset ships in
the repository. Aggregate results may be described only as the maintainer's
private validation case.

- [ ] **Step 4: Add privacy, security, contribution, and troubleshooting docs**

`PRIVACY.md` documents every local artifact and confirms there is no maintainer
backend or telemetry. `SECURITY.md` forbids sharing profiles, cookies, tokens,
conversation data, raw logs, or unredacted screenshots in issues.
`CONTRIBUTING.md` requires synthetic fixtures and `pnpm test` plus
`pnpm privacy:audit`. `docs/troubleshooting.md` covers Chrome not found,
login expiration, no sidebar, selector mismatch, rate limits, partial reads,
plan-hash mismatch, account mismatch, and cleanup recovery implications.
Add the MIT license with `Copyright (c) 2026 ChatGPT Organizer contributors`.

- [ ] **Step 5: Add final package scripts**

Preserve `organizer`, `test`, and `privacy:audit`; add:

```json
{
  "scripts": {
    "check": "pnpm test && pnpm privacy:audit"
  }
}
```

- [ ] **Step 6: Run automated release checks**

Run:

```bash
pnpm check
git status --short
git ls-files
```

Expected: tests and privacy audit PASS; no `.local/` or legacy private path is
tracked; only intentional source, synthetic fixtures, and documentation are
listed.

- [ ] **Step 7: Search staged content for private and forbidden patterns**

Run:

```bash
git grep -n -E '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|Cookie|Authorization: Bearer|sk-[A-Za-z0-9]+'
```

Expected: no real UUID, cookie value, bearer token, or API key appears. Any
documentation mention of the word `Cookie` must be a generic warning and not a
value.

- [ ] **Step 8: Run the final manual acceptance flow**

Using a dedicated ChatGPT account or a deliberately selected five-item subset:

```bash
pnpm organizer doctor --browser
pnpm organizer plan
organizer_plan_hash="$(node -p 'require("./.local/plans/migration-plan.json").planHash')"
pnpm organizer apply --mode pilot --approve "$organizer_plan_hash"
pnpm organizer verify
```

Expected: discovery and planning are read-only; the pilot applies no more than
five approved actions; every action verifies; cleanup targets only `.local/`;
no delete capability is available.

- [ ] **Step 9: Inspect the release diff and commit documentation/cleanup**

```bash
git diff --check
git diff --stat
git add README.md PRIVACY.md SECURITY.md CONTRIBUTING.md LICENSE docs/troubleshooting.md AGENTS.md .agents/skills/chatgpt-organizer/SKILL.md .claude/skills/chatgpt-organizer/SKILL.md src/commands/clean-data.js tests/clean-data.test.js package.json
git commit -m "docs: prepare agent-native v0.1 release"
```

- [ ] **Step 10: Tag only after a final clean verification**

Run:

```bash
pnpm check
git status --short
```

Expected: checks PASS and working tree is clean. Then create the local tag:

```bash
git tag -a v0.1.0 -m "Agent-native ChatGPT Organizer v0.1.0"
```

Pushing the repository, publishing the tag, or creating a GitHub release is a
separate user-authorized external action.
