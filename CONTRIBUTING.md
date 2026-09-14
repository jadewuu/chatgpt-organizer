# Contributing

Thank you for helping make ChatGPT Organizer safer and easier to use.

## Before opening a pull request

1. Read `AGENTS.md`, `docs/workflow.md`, `docs/safety.md`, `PRIVACY.md`, and `SECURITY.md`.
2. Keep changes small and preserve the read-only default, exact plan-hash approval, five-write pilot, bounded resume, verification, and permanent no-delete rule.
3. Add or update tests first for behavior changes. Use only synthetic fixtures and a fake adapter.
4. Run:

   ```bash
   pnpm install
   pnpm test
   pnpm privacy:audit
   pnpm check
   ```

5. Inspect `git status --short` and `git diff --check` before committing.

## Test-data rules

Never contribute real conversation IDs, URLs, titles, messages, Project names, classification output, plan hashes, account/workspace markers, profiles, cookies, tokens, logs, reports, audit events, or screenshots. Create minimal synthetic fixtures whose names and content cannot be confused with personal data.

Public CI must remain deterministic and local. Do not add live ChatGPT writes, real account credentials, copied browser profiles, or external tests that mutate an account. Read-only selector smoke tests must be opt-in and must fail closed.

## Pull requests

Describe the user-visible behavior and safety impact, identify the tests that failed before the implementation and pass afterward, and call out any manual verification that remains. Documentation changes should not promise provider or platform support that has not been verified. ChatGPT Web on macOS with Google Chrome is the only verified v0.1 history target; Codex and Claude Code are agent runtimes.

For suspected vulnerabilities, do not open a normal pull request with exploit details or sensitive artifacts. Follow `SECURITY.md`.
