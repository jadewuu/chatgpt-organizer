const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8");

const safetyClauses = [
  "Read-only by default: `doctor` and `plan` may run without write approval.",
  "Never delete a conversation or Project. No exception is supported.",
  "Do not create Projects, move chats, or archive chats until the user approves the generated plan.",
  "The first approved write run is a maximum five-item pilot.",
  "Stop on rate limits, access restrictions, account mismatch, missing selectors, changed plan hash, or uncertain verification.",
  "Never improvise browser clicks. Use only repository commands and the ChatGPT adapter.",
  "Never stage `.local/`, legacy data, profiles, logs, screenshots, plans, or conversation identifiers.",
  "Read `docs/workflow.md` and `docs/safety.md` before operating on a user's account.",
];

const stages = [
  "1. Run `pnpm organizer doctor` and report failures.",
  "2. Use `pnpm organizer login` only when authentication is required.",
  "3. Run `pnpm organizer plan`; keep all actions read-only.",
  "4. Ask the user to approve the taxonomy and migration report.",
  "5. After explicit approval, run a maximum five-action pilot.",
  "6. Verify the pilot and report results before requesting full-apply approval.",
  "7. Resume approved actions in batches and stop on any safety condition.",
  "8. Run `pnpm organizer verify` and offer `pnpm organizer clean:data`.",
];

const workflowRows = [
  "| `PREFLIGHT` | `pnpm organizer doctor` | Environment and private-data safety report | None; this command is read-only. |",
  "| `AUTHENTICATE` | `pnpm organizer login`, only when authentication is required | Dedicated-profile session and account fingerprint in `.local/state/run.json` | Manual user authentication only; it is not approval to write. |",
  "| `DISCOVER` | `pnpm organizer plan` | Read-only conversation inventory and resumable checkpoints under `.local/` | None; planning is read-only. |",
  "| `TAXONOMY_REVIEW` | `pnpm organizer plan` after the user approves the taxonomy | Approved taxonomy artifact | Explicit approval of the proposed Project taxonomy. |",
  "| `CLASSIFY` | `pnpm organizer plan` | Classifications and a migration plan | The taxonomy approval recorded in the preceding phase. |",
  "| `PLAN_REVIEW` | Record approval, then use `pnpm organizer apply` only for the pilot | Reviewed migration report and plan hash | Explicit approval of the generated migration plan and its taxonomy. |",
  "| `PILOT_APPROVAL` | `pnpm organizer apply` | At most five approved write actions | Explicit approval to execute a maximum five-item pilot from the unchanged plan. |",
  "| `PILOT` | `pnpm organizer verify` | Pilot verification results and audit events | None beyond the pilot approval; stop if any safety condition occurs. |",
  "| `APPLY_APPROVAL` | `pnpm organizer apply` | Approved batched actions | Explicit approval of the verified pilot and the remaining unchanged plan. |",
  "| `APPLY` | `pnpm organizer verify` | Action audit and post-apply verification results | The recorded full-apply approval; stop if any safety condition occurs. |",
  "| `VERIFY` | `pnpm organizer verify` | Final verification report | No new approval; verification must be certain before completion. |",
  "| `COMPLETE` | No command | Completed local audit record | None. Offer `pnpm organizer clean:data`; cleanup requires its own confirmation. |",
];

test("agent entry points share one exact safety and ownership contract", () => {
  const agents = read("AGENTS.md");
  const claude = read("CLAUDE.md");
  const codexSkill = read(".agents/skills/chatgpt-organizer/SKILL.md");
  const claudeSkill = read(".claude/skills/chatgpt-organizer/SKILL.md");
  const workflow = read("docs/workflow.md");
  const safety = read("docs/safety.md");

  for (const clause of safetyClauses) {
    assert.ok(agents.includes(`- ${clause}`), `missing AGENTS safety clause: ${clause}`);
  }
  assert.equal(codexSkill, claudeSkill, "Codex and Claude skills must be byte-for-byte equivalent");
  assert.ok(claude.includes("Read and follow `AGENTS.md` before doing any work in this repository."));
  assert.ok(claude.includes("For ChatGPT history organization, load `.claude/skills/chatgpt-organizer/SKILL.md`."));

  assert.ok(codexSkill.includes("name: chatgpt-organizer"));
  assert.ok(codexSkill.includes("description: Use when asked to organize, classify, move, archive, or review ChatGPT history."));
  assert.ok(codexSkill.includes("Read `AGENTS.md`, `docs/workflow.md`, and `docs/safety.md` before operating on a user's account."));
  for (const [index, stage] of stages.entries()) {
    assert.ok(codexSkill.includes(stage), `missing or changed skill stage ${index + 1}`);
  }
  assert.deepEqual(
    [...codexSkill.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1])),
    [1, 2, 3, 4, 5, 6, 7, 8],
    "skill must contain exactly eight ordered stages",
  );

  const phases = workflowRows.map((row) => row.match(/\| `([^`]+)` \|/)[1]);
  assert.deepEqual(
    [...workflow.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]),
    phases,
    "workflow must list the complete ordered state machine",
  );
  for (const row of workflowRows) assert.ok(workflow.includes(row), `missing workflow contract row: ${row}`);

  const reasoningOwnership = "Semantic reasoning comes from the user's own Codex or Claude Code session.";
  const serviceOwnership = "The repository has no maintainer-owned API key, hosted backend, or maintainer-operated data service.";
  const providerBoundary = "Codex and Claude Code are supported agent runtimes for this repository, but this does not provide Claude Web history or provider compatibility.";
  for (const document of [agents, codexSkill, safety]) {
    assert.ok(document.includes(reasoningOwnership), `missing reasoning ownership language: ${reasoningOwnership}`);
    assert.ok(document.includes(serviceOwnership), `missing service ownership language: ${serviceOwnership}`);
    assert.ok(document.includes(providerBoundary), `missing ChatGPT-only provider boundary: ${providerBoundary}`);
  }
  assert.doesNotMatch(agents, /Claude Web history support is available/i);
  assert.doesNotMatch(safety, /Claude Web history support is available/i);
});
