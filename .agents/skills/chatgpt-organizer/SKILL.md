---
name: chatgpt-organizer
description: Use when asked to organize, classify, move, archive, or review ChatGPT history.
---

Read `AGENTS.md`, `docs/workflow.md`, and `docs/safety.md` before operating on a user's account. Follow the repository contract over convenience or speed.

Semantic reasoning comes from the user's own Codex or Claude Code session. The repository has no maintainer-owned API key, hosted backend, or maintainer-operated data service. Codex and Claude Code are supported agent runtimes for this repository, but this does not provide Claude Web history or provider compatibility.

The new v0.1 adapter is experimental and authenticated acceptance is pending. No trusted native unique-workspace identity contract is established yet, so account-bound operations fail closed. Do not substitute a visible label, invent an ID, or claim a completed extraction when that gate stops the workflow. Earlier personal validation of legacy scripts does not validate this replacement; do not tag or publish until authenticated acceptance succeeds.

Planning and classification contract: `pnpm organizer plan` is read-only and keeps all private IDs and content below `.local/`. The first classification pass contains only each title, created/updated timestamps, first user message, and last user message. Process `classification-input.jsonl` in bounded batches. Request additional excerpts only when the user has allowed full-content review and the prior exact conversation ID has confidence below `fullContentBelow`. Write only schema-valid `classifications.json`; every row must use an exact input `conversationId`, a confidence from 0 through 1, and a concise reason. Never classify an unresolved conversation as `archive`; archive is independent and always requires an `archiveReason`.

Before marking a taxonomy reviewed, show representative conversation-title samples and estimated counts for every proposed Project, and ask the user to approve or customize it. Taxonomy approval and plan review are separate explicit checkpoints; a classification artifact is not write authorization.

1. Run `pnpm organizer doctor` and report failures.
2. Use `pnpm organizer login` only when authentication is required.
3. Run `pnpm organizer discover` for metadata, then `pnpm organizer plan` to prepare the taxonomy; keep all actions read-only.
4. Obtain taxonomy approval, run `node scripts/04-read.js --all` for complete private message checkpoints, then `pnpm organizer plan` to produce first/last-message input. Write bounded schema-valid classifications, rerun `plan`, and ask the user to review the migration report.
5. After explicit approval, run a maximum five-action pilot.
6. Verify the pilot and report results before requesting full-apply approval.
7. Resume approved actions in batches and stop on any safety condition.
8. Run `pnpm organizer verify` and offer `pnpm organizer clean:data`.

Approve the pilot only by passing the exact unchanged plan hash to `pnpm organizer apply --mode pilot --approve <plan-hash>`.

After pilot verification, obtain separate approval before `pnpm organizer apply --mode resume --approve <plan-hash>`; every resume is bounded and stops on uncertainty.

Verify every completed batch before another resume. While actions remain, successful verification returns to APPLY_APPROVAL and the next invocation requires fresh exact-hash approval. Only final verification may mark COMPLETE. Before any writes, edit taxonomy/classifications and rerun `plan` in PLAN_REVIEW to invalidate prior approvals and regenerate the report. After a possible write, preserve the plan and audit and use the conservative recovery procedure in `docs/troubleshooting.md`; never edit execution state or hashes.

Normal `pnpm organizer clean:data` preserves `.local/state` and `.local/profile`; `--include-profile` requires a separate confirmation and a new login afterward.

Before any approved write, if `config/organizer.yaml` does not exist, create the Git-ignored local config once:

```bash
cp config/organizer.example.yaml config/organizer.yaml
```

Enable only the action flags required by the reviewed plan. Set `allowCreateProjects` only for planned Project creation, `allowMove` only for planned moves, and `allowArchive` only for planned archives. Leave unused flags `false` and keep `neverDelete: true`.

These flags are capability gates, not write approval, and they do not replace explicit approval of the exact unchanged plan hash.
