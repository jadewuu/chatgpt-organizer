# Agent-native ChatGPT Organizer v0.1 Design

Status: Proposed for user review  
Date: 2026-09-12  
Scope: ChatGPT Web on macOS with Google Chrome

## 1. Decision Summary

Version 0.1 will remain a ChatGPT-specific project named `chatgpt-organizer`.
It will be distributed as an agent-native repository that users open with their
own Codex or Claude Code session. The user's coding agent provides semantic
reasoning; repository scripts provide deterministic browser operations,
validation, persistence, and safety controls.

Version 0.1 will not claim support for Claude Web, Gemini, or other AI chat
providers. The internal code may keep a small ChatGPT adapter boundary, but it
will not introduce a generic provider framework until a second provider has
been implemented and tested.

The public promise is:

> Use your own Codex or Claude Code to understand and safely organize your
> ChatGPT conversation history into native ChatGPT Projects.

## 2. Goals

Version 0.1 must let a new user:

1. Clone the repository and start from Codex or Claude Code.
2. Confirm that their local environment is compatible and private data is not
   tracked by Git.
3. Log into ChatGPT manually in a dedicated Chrome profile.
4. Discover and read their ChatGPT conversation history with resumable local
   progress.
5. Define or approve a personal Project taxonomy.
6. Generate a reviewable classification and migration plan without modifying
   ChatGPT.
7. Run a five-item pilot after explicit approval.
8. Resume approved moves and archives in safe batches.
9. Verify results and retain a local audit record.
10. Delete locally extracted conversation data with an explicit cleanup
    command.

## 3. Non-goals

Version 0.1 will not include:

- Claude, Gemini, DeepSeek, Grok, or other conversation providers.
- A hosted service or shared backend.
- API keys owned by the maintainer.
- A desktop GUI or browser extension.
- Automatic deletion of conversations or Projects.
- Cross-device synchronization.
- Knowledge consolidation, vector search, or a knowledge graph.
- Guaranteed support for Windows or Linux.
- Automatic retry after ChatGPT rate-limit or access-restriction warnings.

## 4. Target User and Prerequisites

The initial user is a technical ChatGPT power user who:

- Uses macOS and Google Chrome.
- Has Node.js and pnpm installed.
- Has their own Codex or Claude Code access.
- Has a large ChatGPT history and wants to use native ChatGPT Projects.
- Accepts that browser automation against an evolving web UI can break.
- Is willing to review a plan before allowing write operations.

The repository will state that it is unofficial, not affiliated with OpenAI,
and may stop working when ChatGPT changes its UI or internal behavior.

## 5. Primary User Experience

### 5.1 Installation

```bash
git clone https://github.com/OWNER/chatgpt-organizer.git
cd chatgpt-organizer
pnpm install
```

The README then offers two agent entry points:

```bash
codex
```

or:

```bash
claude
```

The user's first prompt is:

> Use this repository's ChatGPT Organizer workflow. Check my environment and
> generate an organization plan first. Do not create Projects, move chats, or
> archive anything without my explicit approval.

### 5.2 Guided Flow

The agent guides the user through this fixed sequence:

```text
PREFLIGHT
  -> AUTHENTICATE
  -> DISCOVER
  -> TAXONOMY_REVIEW
  -> CLASSIFY
  -> PLAN_REVIEW
  -> PILOT_APPROVAL
  -> PILOT
  -> APPLY_APPROVAL
  -> APPLY
  -> VERIFY
  -> COMPLETE
```

Closing the coding agent or browser must not lose completed work. A later agent
session reads the saved state and offers to resume from the last safe state.

## 6. Repository Instruction Layer

### 6.1 `AGENTS.md`

The repository root will contain a concise, platform-neutral `AGENTS.md`. It
will define:

- The read-only default.
- The state machine and allowed transitions.
- The actions that require explicit user approval.
- The permanent prohibition on deleting chats or Projects.
- The rule to stop immediately on rate limits or uncertain UI state.
- The commands agents are allowed to call.
- The files that contain workflow details and schemas.

Personal Project names, real conversation IDs, and author-specific history
will not appear in the public `AGENTS.md`.

### 6.2 `CLAUDE.md`

`CLAUDE.md` will be a short compatibility entry point. It will instruct Claude
Code to read and follow the root `AGENTS.md` and the repository workflow skill.
It will not duplicate the full safety contract.

### 6.3 Repository Skills

The repository will expose equivalent skill entry points for supported coding
agents:

```text
.agents/skills/chatgpt-organizer/SKILL.md
.claude/skills/chatgpt-organizer/SKILL.md
```

Both entry points will reference the same canonical workflow documents and
scripts. Model-specific wrappers may explain discovery conventions, but they
must not define different safety behavior.

## 7. Component Architecture

### 7.1 Agent Layer

The user's Codex or Claude Code session is responsible for:

- Explaining the workflow and its risks.
- Asking for taxonomy preferences.
- Suggesting Project names from sampled conversation data.
- Classifying conversations semantically.
- Returning a confidence score and concise reason for each classification.
- Explaining unresolved items.
- Requesting user approval at state transitions.

The agent must not directly improvise browser clicks or edit progress files to
bypass validation.

### 7.2 Deterministic Script Layer

Repository scripts are responsible for:

- Launching the dedicated Chrome profile.
- Discovering and reading ChatGPT conversations.
- Writing resumable local state.
- Validating taxonomy, classification, and migration-plan schemas.
- Creating Projects, moving conversations, and archiving conversations.
- Enforcing batch limits, delays, action allowlists, and state transitions.
- Verifying each completed action.
- Writing append-only audit events.

The script layer will not decide semantic categories.

### 7.3 ChatGPT Adapter Boundary

ChatGPT-specific browser behavior will be isolated behind a small adapter:

```text
discoverConversations()
readConversation(id)
listProjects()
createProject(name)
moveConversation(id, project)
archiveConversation(id)
verifyConversationLocation(id, expectedLocation)
```

This boundary improves testability and maintenance. It is not a promise of
future multi-provider support.

### 7.4 Command Layer

Users and agents interact through four primary commands:

```bash
pnpm organizer doctor
pnpm organizer plan
pnpm organizer apply
pnpm organizer verify
```

Additional explicit commands are allowed for authentication and cleanup:

```bash
pnpm organizer login
pnpm organizer clean:data
```

Existing numbered scripts become internal implementation details. The README
will not require new users to coordinate numbered scripts manually.

## 8. State and Authorization Model

The current run is stored in a Git-ignored local file:

```text
.local/state/run.json
```

It contains:

- A random run ID.
- An account fingerprint that does not expose the user's email or session.
- Current workflow state.
- Input and plan hashes.
- Completed discovery and extraction checkpoints.
- Pilot and apply approvals.
- Counts of pending, completed, failed, and skipped actions.

The rules are:

1. `doctor` and `plan` are always read-only.
2. `apply` refuses to run unless the plan passes schema validation.
3. `apply` refuses to run if the current account fingerprint differs from the
   account that produced the plan.
4. The first write run is limited to five actions.
5. Full apply is unavailable until the pilot has been verified.
6. Editing the plan invalidates prior approval and requires re-review.
7. Delete operations do not exist in the adapter or command interface.
8. Rate-limit or access-restriction detection stops the run; it never starts an
   automatic cooldown-and-retry loop.

## 9. Local Data Layout

All user-derived files live below one ignored directory:

```text
.local/
├── profile/
├── state/
│   └── run.json
├── raw/
│   ├── conversations.json
│   └── conversations/
├── plans/
│   ├── taxonomy.yaml
│   ├── classifications.json
│   └── migration-plan.json
├── reports/
│   └── review.html
├── audit/
│   └── events.jsonl
└── logs/
```

The public repository contains only synthetic fixtures. The entire `.local/`
directory is ignored. Root-level files must never contain real conversation
titles, IDs, messages, screenshots, cookies, or login markers.

`pnpm organizer clean:data` shows the exact target path, requests confirmation,
and removes `.local/raw`, `.local/plans`, `.local/reports`, `.local/audit`, and
`.local/logs`. It does not remove the dedicated browser profile unless the user
passes a separate explicit profile-cleanup option.

## 10. Taxonomy Design

The repository includes a generic starter taxonomy but does not assume it is
correct for the user. The user may:

- Accept the starter taxonomy.
- Provide a YAML taxonomy.
- Ask the coding agent to suggest a taxonomy from a read-only sample.

Each Project definition contains:

```yaml
name: Coding
description: Programming, debugging, architecture, and developer tools.
include: []
exclude: []
```

The agent proposes between 4 and 12 Projects by default. It must show sample
conversation titles and estimated counts for each proposed Project. Full
classification starts only after the user approves the taxonomy.

## 11. Classification Design

Classification uses progressive disclosure to control privacy, latency, and
context size:

1. First pass: title, timestamps, first user message, and last user message.
2. Second pass: additional excerpts only for ambiguous conversations.
3. Full conversation: only when needed and allowed by the user.

Every classification result contains:

```json
{
  "conversationId": "synthetic-id",
  "project": "Coding",
  "confidence": 0.97,
  "reason": "Discusses an ongoing application architecture and debugging work.",
  "suggestedAction": "move"
}
```

Default policy:

- Confidence `>= 0.95`: eligible for a suggested move.
- Confidence `< 0.95`: unresolved and retained in place.
- Archive candidacy is an independent decision with its own reason.
- Unresolved conversations are never converted into archive candidates merely
  because they lack a category.
- No classification result is a write authorization.

The user's coding-agent subscription or account supplies all model reasoning.
The repository does not require a maintainer-owned API key or send data through
a maintainer-operated service.

## 12. Review Report

`plan` generates a local static HTML report containing:

- Conversation totals and coverage.
- Proposed Projects and counts.
- High-confidence moves.
- Unresolved conversations.
- Archive candidates with independent reasons.
- Current Project, proposed Project, confidence, and explanation.
- Filters by Project, action, and confidence.

Version 0.1 may keep report editing outside the browser. The report must clearly
show the YAML/JSON files the user or agent should modify, and regenerating the
report must be deterministic.

## 13. Apply and Verification

### 13.1 Pilot

The first approved write run performs at most five actions. Moves are preferred
over archives for the initial pilot. After each action, the script verifies the
new location or another reliable observable result and writes an audit event.

The pilot stops on the first uncertain result.

### 13.2 Full Apply

After successful pilot verification and renewed user approval, actions execute
in bounded batches. Each item has one of these states:

```text
pending | running | done | failed | skipped | uncertain
```

`done` requires post-action verification. `uncertain` stops the batch. Failed
items are not retried automatically more than once in the same run, and
rate-limited items are never automatically retried.

### 13.3 Audit

Every write attempt appends an event with:

- Run ID and timestamp.
- Provider (`chatgpt`).
- Conversation identifier in the private local file.
- Planned action and destination.
- Previous known location.
- Result and verification evidence.
- Error category when applicable.

The audit file is local and Git-ignored.

## 14. Error Handling

The workflow stops and explains the next safe step when:

- The user is logged out.
- ChatGPT shows a rate-limit, access-restriction, or verification page.
- Required selectors are missing or ambiguous.
- The account fingerprint changes.
- The plan hash differs from the approved plan.
- The expected Project is unavailable.
- A write action cannot be verified.
- The browser closes unexpectedly during a write operation.

Read-only discovery may resume from its last checkpoint after browser restart.
Write operations require a fresh verification of account, plan, and current
item state before resuming.

## 15. Privacy and Security

The release will include `PRIVACY.md` and `SECURITY.md` covering:

- Exactly which ChatGPT data is read.
- Where it is stored locally.
- Which data the user's coding agent may process.
- The fact that the maintainer receives no conversation data.
- The absence of telemetry by default.
- Safe cleanup and bug-report redaction.
- The risks of using unofficial browser automation.

Browser profiles, cookies, raw conversations, derived summaries, reports, and
audit logs are never committed. Diagnostic bundles redact conversation IDs,
titles, message text, profile paths, and account identifiers by default.

## 16. Testing Strategy

Automated tests use synthetic fixtures and a fake ChatGPT adapter. They cover:

- Conversation normalization.
- Taxonomy and classification schema validation.
- Confidence threshold behavior.
- The rule that unresolved does not imply archive.
- Plan hashing and approval invalidation.
- State-machine transitions.
- Pilot limits.
- Idempotent resume behavior.
- Stop behavior for rate limits and uncertain verification.
- Log and diagnostic redaction.

Browser selector smoke tests are read-only and opt-in. Live write tests never
run in public CI and require a dedicated test account plus explicit manual
approval.

All JavaScript files must pass syntax checks. The public project will expose a
single verification command:

```bash
pnpm test
```

## 17. Documentation and Release Contents

The public repository will include:

- A concise README with a 60-second demo and the exact first prompt.
- `AGENTS.md` and `CLAUDE.md` entry points.
- A provider-support table that lists only ChatGPT as verified.
- Installation, privacy, safety, troubleshooting, and limitations sections.
- Synthetic example data and an example review report.
- An open-source license.
- `CONTRIBUTING.md`, `SECURITY.md`, and `PRIVACY.md`.
- A tagged v0.1 release with macOS and Chrome compatibility notes.

The README will not expose the author's real Project taxonomy, conversation
counts as bundled data, conversation IDs, business names, family details, or
screenshots containing private sidebar content. Aggregate numbers may be used
in the project story when no individual conversation can be identified.

## 18. Migration from the Current Repository

Implementation will proceed in this order:

1. Create a clean public-data boundary and move all generated user data under
   `.local/`.
2. Replace the current singular `AGENT.md` with a sanitized root `AGENTS.md`.
3. Add the Claude Code compatibility entry point and repository skills.
4. Introduce schemas and the persisted workflow state machine.
5. Wrap existing behavior behind `doctor`, `plan`, `apply`, and `verify`.
6. Move ChatGPT-specific selectors and operations behind the adapter boundary.
7. Replace personal classification rules with configurable taxonomy input.
8. Generate the local review report.
9. Add synthetic tests and fixtures.
10. Rewrite release documentation and perform a final privacy audit before Git
    initialization and the first public commit.

The existing verified ChatGPT behavior is preserved while its entry points and
data boundaries are made safe for strangers to use.

## 19. Release Acceptance Criteria

Version 0.1 is ready to publish when all of the following are true:

- A fresh clone contains no real user data or browser state.
- Codex automatically loads the root instructions.
- Claude Code is directed to the same safety contract.
- A new user can reach a read-only plan using documented steps.
- The example prompt produces the expected guided workflow.
- The taxonomy is user-configurable and contains no author-specific Projects.
- The migration plan passes schema validation.
- Apply is impossible before explicit plan approval and a five-item pilot.
- Delete operations are absent from public interfaces.
- Rate-limit detection stops instead of retrying automatically.
- Interrupted work resumes without repeating verified actions.
- All automated tests pass on synthetic fixtures.
- README, LICENSE, SECURITY, PRIVACY, and troubleshooting documentation exist.
- A manual test using a dedicated ChatGPT account completes discovery, plan,
  pilot, apply, and verification successfully.

