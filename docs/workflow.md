# Organizer Workflow

Read [AGENTS.md](../AGENTS.md) and [safety.md](safety.md) before operating on a user's account. The workflow is fixed; do not skip phases or substitute browser actions for repository commands.

This workflow is exercised with synthetic data, and its login, metadata discovery, and native Project discovery paths passed authenticated read-only acceptance on 2026-09-26. The experimental identity contract binds `/backend-api/me` to one observed `chatgpt-account-id` that `/backend-api/wham/accounts/check` confirms is session-accessible. Only hashes are persisted. Every approved write operation must freshly re-establish that evidence and keep one visible workspace context stable throughout the operation. Do not substitute a visible label, reuse stale evidence, or edit a fingerprint to bypass a stop.

| Phase | Command that advances the workflow | Artifact produced | Exact approval needed |
| --- | --- | --- | --- |
| `PREFLIGHT` | `pnpm organizer doctor` | Environment and private-data safety report | None; this command is read-only. |
| `AUTHENTICATE` | `pnpm organizer login`, only when authentication is required | Dedicated-profile session and account/workspace fingerprints in `.local/state/account.json` | Manual user authentication only; it is not approval to write. |
| `DISCOVER` | `pnpm organizer discover`, then `pnpm organizer plan` | Metadata inventory and Projects in `.local/raw/`, run state in `.local/state/run.json`; `plan` prepares `.local/plans/taxonomy.yaml` and enters `TAXONOMY_REVIEW` | None; discovery and planning are read-only. |
| `TAXONOMY_REVIEW` | After taxonomy approval, `node scripts/04-read.js --all`, then `pnpm organizer plan` | Complete message checkpoints in `.local/raw/conversations/`, then first/last-message `classification-input.jsonl` | Explicit approval of the proposed Project taxonomy. Extraction is read-only; further model excerpts require separate full-content permission. |
| `CLASSIFY` | Agent writes schema-valid `classifications.json`, then `pnpm organizer plan` | Hashed migration plan and `.local/reports/review.html` | The taxonomy approval recorded in the preceding phase. |
| `PLAN_REVIEW` | Record approval, then use `pnpm organizer apply` only for the pilot | Reviewed migration report and plan hash | Explicit approval of the generated migration plan and its taxonomy. |
| `PILOT_APPROVAL` | `pnpm organizer apply` | At most five approved write actions | Explicit approval to execute a maximum five-item pilot from the unchanged plan. |
| `PILOT` | `pnpm organizer verify` | Pilot verification results and audit events | None beyond the pilot approval; stop if any safety condition occurs. |
| `APPLY_APPROVAL` | `pnpm organizer apply` | Approved batched actions | Explicit approval of the verified pilot and the remaining unchanged plan. |
| `APPLY` | `pnpm organizer verify` | Verified batch returns to `APPLY_APPROVAL` if work remains; otherwise advances through `VERIFY` to `COMPLETE` | Each next batch requires fresh exact-hash approval after successful verification; stop if any safety condition occurs. |
| `VERIFY` | `pnpm organizer verify` | Final verification report | No new approval; verification must be certain before completion. |
| `COMPLETE` | No command | Completed local audit record | None. Offer `pnpm organizer clean:data`; cleanup requires its own confirmation. |

`doctor` and `plan` are read-only. `apply` may create Projects, move chats, or archive chats only after the approvals listed above. Before writes, edit taxonomy/classifications and rerun `plan` in `PLAN_REVIEW` to regenerate the report and invalidate approvals. After any possible write, plan regeneration is blocked; follow the conservative recovery procedure in [troubleshooting.md](troubleshooting.md).
