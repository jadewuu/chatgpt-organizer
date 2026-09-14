# Security Policy

## Supported version

Security fixes are accepted for the latest code on the default branch. This v0.1 project is unofficial browser automation for ChatGPT Web; interface changes may break its assumptions without notice.

## Reporting a vulnerability

Use the repository's private GitHub security-advisory channel when available. If no private channel is available, open a public issue that requests a secure contact method but contains no vulnerability details or private artifacts.

Never put profiles, cookies, tokens, session data, API keys, conversation content, raw logs, migration plans, audit events, account/workspace identifiers, or unredacted screenshots in an issue, pull request, discussion, or public advisory comment. Build a synthetic reproduction and redact paths and identifiers before sharing it. Do not send secrets to maintainers.

Include the affected commit, operating-system and Chrome versions, the command and workflow phase, the expected fail-closed behavior, and a minimal synthetic reproduction. Do not perform live-write testing against another person's account.

## Security boundaries

- All user-derived artifacts belong under the ignored `.local/` directory.
- The dedicated Chrome profile contains cookies and login state and must be treated as a secret-bearing directory.
- Semantic processing occurs in the user's own Codex or Claude Code runtime. There is no maintainer API key, backend, telemetry, or data-collection service.
- Only ChatGPT Web history is a verified v0.1 target. Claude Web history is unsupported and unverified; Codex and Claude Code are runtimes, not providers.
- Planning is read-only. Writes require the exact unchanged plan hash, stable account/workspace context, a maximum five-write pilot, verification, and separate approval for bounded resume.
- Conversation and Project deletion is unsupported. Never add or improvise a delete operation.
- Rate limits, access restrictions, account/workspace mismatches, selector ambiguity, browser interruption, and uncertain verification are stop conditions, not retry invitations.

## Dependency and automation risk

Review dependency updates and lockfile changes before merging. Public CI and contributions must use synthetic fixtures and fake adapters; live browser writes do not belong in CI. Because ChatGPT's private web interface can change, selector failures must stop safely. Do not work around a mismatch with ad-hoc browser clicks, copied browser state, edited plan/state files, or disabled approval gates.

## Local cleanup

Use `pnpm organizer clean:data` for contained cleanup. It preserves run state and the profile by default. `--include-profile` requires a second confirmation and means you must log in again. Never replace the command with a recursive deletion of the repository or an unverified path.
