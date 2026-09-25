# ChatGPT Extraction Completion Evidence Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a stable but still-generating ChatGPT assistant response from being persisted or reused as a complete extraction checkpoint.

**Architecture:** Validate native completion metadata at the normalization boundary before returning the active text-message branch. The adapter continues to require a fresh full-ID response and two matching stable DOM observations, but only a natively complete branch may participate in that comparison.

**Tech Stack:** Node.js 20+, CommonJS, Node's built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-12-agent-native-chatgpt-v0.1-design.md`

## Global Constraints

- ChatGPT Web on macOS with Google Chrome remains the only target; authenticated adapter acceptance is still pending.
- Unknown, absent, generating, or unsuccessful native completion metadata must fail closed and must not create a reusable checkpoint.
- A supported active branch requires every user or assistant message to have `status === "finished_successfully"`.
- Every assistant message on the active branch additionally requires `end_turn === true`.
- Normalized persisted messages remain limited to `{ role, text }`; native status metadata is validation evidence, not stored conversation content.
- Existing fresh full-ID response binding, stable rendered observations, account/workspace gates, privacy containment, and no-delete behavior must remain unchanged.
- No live browser/account access, cleanup, tag, merge, push, or publication is allowed in this task.

## Review Focus

- `status: "in_progress"` with matching stable partial DOM must be rejected and never persisted.
- `status: "finished_successfully"` with assistant `end_turn: false`, missing, or non-boolean must be rejected.
- Missing or unknown message status must fail closed instead of inheriting old permissive behavior.
- A completed user-only branch may pass with `status: "finished_successfully"`; assistant `end_turn` is not fabricated for user messages.
- A completed user-plus-assistant branch must still extract and be reusable only after all existing adapter evidence gates pass.

---

### Task 1: Preserve native completion evidence through the extraction decision

**Files:**
- Modify: `src/providers/chatgpt/normalize.js`
- Modify: `tests/chatgpt-normalize.test.js`
- Modify: `tests/chatgpt-adapter.test.js`

**Interfaces:**
- Consumes: ChatGPT detail payload `{ conversation_id, current_node, mapping }` and the existing `detailMessages(data, id)` boundary.
- Produces: `detailMessages(data, id): Array<{role: "user"|"assistant", text: string}> | null`, returning messages only when the complete active branch satisfies the exact metadata contract above.

- [ ] **Step 1: Add a failing normalization test for unfinished and unknown branches**

Add table-driven cases proving `detailMessages()` returns `null` for assistant `status: "in_progress"`, assistant `end_turn: false`, missing assistant `end_turn`, missing status, and unknown status. Include literal valid user-only and user-plus-assistant payloads that return normalized `{role,text}` messages.

- [ ] **Step 2: Run the focused normalization test and verify RED**

Run: `node --test tests/chatgpt-normalize.test.js`

Expected: FAIL because the current implementation discards completion metadata and accepts unfinished branches.

- [ ] **Step 3: Add a failing adapter-boundary regression**

Extend the synthetic response fixture without weakening it globally. Prove a fresh detail response with a completed user message and assistant `status: "in_progress", end_turn: false`, whose partial text matches two stable non-busy DOM observations, rejects extraction, writes no checkpoint, and cannot be reused by a second read. Also retain a positive completed user-plus-assistant extraction case.

- [ ] **Step 4: Run the adapter regression and verify RED**

Run: `node --test --test-name-pattern='unfinished native message|completed native branch' tests/chatgpt-adapter.test.js`

Expected: FAIL because the unfinished assistant branch is currently persisted as complete.

- [ ] **Step 5: Implement the minimal normalization guard**

In `detailMessages(data, id)`, validate each active-branch user/assistant message before stripping metadata: require `status === "finished_successfully"`; for assistant messages require `end_turn === true`. Return `null` for missing, unknown, unsuccessful, or generating metadata. Keep all existing ID, branch-cycle, role, text-content, and nonempty-text validation.

- [ ] **Step 6: Verify focused tests GREEN**

Run:

```bash
node --test tests/chatgpt-normalize.test.js tests/chatgpt-adapter.test.js
```

Expected: all focused tests pass, including the adapter checkpoint persistence/reuse assertions.

- [ ] **Step 7: Run the complete repository verification**

Run:

```bash
pnpm check
git ls-files -z '*.js' | xargs -0 -n1 node --check
git diff --check
```

Expected: all tests and privacy audit pass; syntax and diff checks emit no errors.

- [ ] **Step 8: Commit and report**

Commit only the plan, normalization implementation, and covering synthetic tests with message `fix: require completed native extraction branch`. Write the ignored task report with RED/GREEN commands and outputs. Do not tag or publish.
