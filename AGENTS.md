# ChatGPT Organizer Agent Contract

- Read-only by default: `doctor` and `plan` may run without write approval.
- Never delete a conversation or Project. No exception is supported.
- Do not create Projects, move chats, or archive chats until the user approves the generated plan.
- The first approved write run is a maximum five-item pilot.
- Stop on rate limits, access restrictions, account mismatch, missing selectors, changed plan hash, or uncertain verification.
- Never improvise browser clicks. Use only repository commands and the ChatGPT adapter.
- Never stage `.local/`, legacy data, profiles, logs, screenshots, plans, or conversation identifiers.
- Read `docs/workflow.md` and `docs/safety.md` before operating on a user's account.
- Semantic reasoning comes from the user's own Codex or Claude Code session.
- The repository has no maintainer-owned API key, hosted backend, or maintainer-operated data service.
- Codex and Claude Code are supported agent runtimes for this repository, but this does not provide Claude Web history or provider compatibility.
