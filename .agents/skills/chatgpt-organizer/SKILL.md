---
name: chatgpt-organizer
description: Use when asked to organize, classify, move, archive, or review ChatGPT history.
---

Read `AGENTS.md`, `docs/workflow.md`, and `docs/safety.md` before operating on a user's account. Follow the repository contract over convenience or speed.

1. Run `pnpm organizer doctor` and report failures.
2. Use `pnpm organizer login` only when authentication is required.
3. Run `pnpm organizer plan`; keep all actions read-only.
4. Ask the user to approve the taxonomy and migration report.
5. After explicit approval, run a maximum five-action pilot.
6. Verify the pilot and report results before requesting full-apply approval.
7. Resume approved actions in batches and stop on any safety condition.
8. Run `pnpm organizer verify` and offer `pnpm organizer clean:data`.
