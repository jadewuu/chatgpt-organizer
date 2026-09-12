# Organizer Safety

## Local data and profiles

All user-derived data belongs under the Git-ignored `.local/` directory, including the dedicated browser profile, state, raw conversations, plans, reports, audit events, and logs. Public files and tests use only synthetic examples. Do not stage `.local/`, legacy data, profiles, logs, screenshots, plans, or conversation identifiers.

Use a dedicated Chrome profile for this workflow. Authenticate manually only when the repository command requests it. Never copy cookies, session tokens, profile data, or conversation content into tracked files or bug reports.

## Reasoning and service ownership

Semantic reasoning comes from the user's own Codex or Claude Code session. The repository has no maintainer-owned API key, hosted backend, or maintainer-operated data service.

## Permanent limits

Deleting conversations or Projects is unsupported. The adapter and public command interface have no delete operation. `doctor` and `plan` are read-only; creating Projects, moving chats, and archiving chats require exact approval of the generated plan. The first write run is limited to five actions, and full apply requires a verified pilot plus separate approval.

## Stop conditions

Stop immediately on a rate limit, access restriction, account mismatch, missing or ambiguous selector, changed plan hash, unavailable expected Project, browser interruption during a write, or uncertain verification. Do not automatically retry rate-limited writes. Re-check the account, unchanged plan, and current item state before any approved resume.

## Unofficial automation and support

This is unofficial browser automation for ChatGPT Web and may break when ChatGPT changes its interface or behavior. Use only repository commands and the ChatGPT adapter; never improvise browser clicks. Codex and Claude Code are supported agent runtimes for this repository, but this does not provide Claude Web history or provider compatibility.

## Bug-report redaction

Before sharing diagnostics, redact conversation IDs, titles, message text, profile paths, account identifiers, cookies, session markers, screenshots, plans, raw data, reports, audit events, and logs. Share only the smallest synthetic reproduction or redacted command output needed to explain the issue.
