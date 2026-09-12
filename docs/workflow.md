# Organizer Workflow

Read [AGENTS.md](../AGENTS.md) and [safety.md](safety.md) before operating on a user's account. The workflow is fixed; do not skip phases or substitute browser actions for repository commands.

| Phase | Command that advances the workflow | Artifact produced | Exact approval needed |
| --- | --- | --- | --- |
| `PREFLIGHT` | `pnpm organizer doctor` | Environment and private-data safety report | None; this command is read-only. |
| `AUTHENTICATE` | `pnpm organizer login`, only when authentication is required | Dedicated-profile session and account fingerprint in `.local/state/run.json` | Manual user authentication only; it is not approval to write. |
| `DISCOVER` | `pnpm organizer plan` | Read-only conversation inventory and resumable checkpoints under `.local/` | None; planning is read-only. |
| `TAXONOMY_REVIEW` | `pnpm organizer plan` after the user approves the taxonomy | Approved taxonomy artifact | Explicit approval of the proposed Project taxonomy. |
| `CLASSIFY` | `pnpm organizer plan` | Classifications and a migration plan | The taxonomy approval recorded in the preceding phase. |
| `PLAN_REVIEW` | Record approval, then use `pnpm organizer apply` only for the pilot | Reviewed migration report and plan hash | Explicit approval of the generated migration plan and its taxonomy. |
| `PILOT_APPROVAL` | `pnpm organizer apply` | At most five approved write actions | Explicit approval to execute a maximum five-item pilot from the unchanged plan. |
| `PILOT` | `pnpm organizer verify` | Pilot verification results and audit events | None beyond the pilot approval; stop if any safety condition occurs. |
| `APPLY_APPROVAL` | `pnpm organizer apply` | Approved batched actions | Explicit approval of the verified pilot and the remaining unchanged plan. |
| `APPLY` | `pnpm organizer verify` | Action audit and post-apply verification results | The recorded full-apply approval; stop if any safety condition occurs. |
| `VERIFY` | `pnpm organizer verify` | Final verification report | No new approval; verification must be certain before completion. |
| `COMPLETE` | No command | Completed local audit record | None. Offer `pnpm organizer clean:data`; cleanup requires its own confirmation. |

`doctor` and `plan` are read-only. `apply` may create Projects, move chats, or archive chats only after the approvals listed above. A changed plan hash invalidates approval and returns the work to `PLAN_REVIEW`.
