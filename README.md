# ChatGPT Organizer

Use your own Codex or Claude Code session to understand your ChatGPT history and safely organize it into native ChatGPT Projects.

## Sanitized before and after

The example below is synthetic; no maintainer conversation data ships with this repository.

| Before: ChatGPT history | Proposed result after review |
| --- | --- |
| `Debug a failing unit test` | Move to `Coding` |
| `Build a study routine` | Move to `Learning` |
| `Temporary weekly notes` | Keep in place or independently review for archive |

The read-only plan explains each suggestion, its confidence, the current and proposed Project, and unresolved items. Nothing changes in ChatGPT until you approve the exact plan hash.

## Provider support

| History provider | v0.1 status |
| --- | --- |
| ChatGPT Web history | Only target; experimental v0.1 adapter on macOS with Google Chrome; authenticated acceptance pending |
| Claude Web history | Unsupported and unverified |

Codex and Claude Code are supported **agent runtimes**, not history providers. Their semantic AI capability belongs to your own account. This repository supplies deterministic local scripts; it has no maintainer API key, hosted backend, telemetry, or maintainer-operated data service.

Earlier personal scripts were manually exercised by the author. That experience does not validate this new adapter. The native contract for a stable unique workspace ID has not been established, so this version deliberately stops account-bound reads and writes with a workspace-identity error. Synthetic tests exercise the intended workflow; authenticated discovery, extraction, selectors, and an explicitly approved five-write pilot remain required before a release tag or publication.

## Read-only by default

Environment checks, discovery, classification input, taxonomy review, planning, and the local report are read-only. Creating Projects, moving chats, and archiving chats require approval of an unchanged plan. The first write run is capped at five actions and must be verified before a separately approved bounded resume. Deleting conversations or Projects is not supported anywhere in the command or adapter interfaces.

Stop on rate limits, access restrictions, account or workspace mismatch, changed plan hash, missing or ambiguous selectors, browser interruption, or uncertain verification. This project never treats login as write approval.

## Requirements and installation

- macOS
- Google Chrome
- Node.js 20 or newer
- pnpm
- Your own Codex or Claude Code access

```bash
git clone https://github.com/jadewuu/chatgpt-organizer.git
cd chatgpt-organizer
pnpm install
pnpm organizer doctor
```

Start one supported agent runtime from the repository root:

```bash
codex
```

or:

```bash
claude
```

## Exact first prompts

For Codex, paste:

> Use this repository's ChatGPT Organizer workflow. Read AGENTS.md and the chatgpt-organizer skill, check my environment, and generate a read-only organization plan first. Do not create Projects, move chats, or archive anything without my explicit approval of the exact plan hash.

For Claude Code, paste:

> Use this repository's ChatGPT Organizer workflow. Read CLAUDE.md, AGENTS.md, and the chatgpt-organizer skill, check my environment, and generate a read-only organization plan first. Do not create Projects, move chats, or archive anything without my explicit approval of the exact plan hash.

## Plan, pilot, apply, verify, and clean up

The following is the intended sequence after the workspace-identity contract passes authenticated acceptance. The current adapter stops at that gate; do not bypass it or treat extraction as complete:

1. **Preflight and login.** Run `pnpm organizer doctor`. When authentication is needed, run `pnpm organizer login` and sign in manually in the dedicated Chrome profile. Do not copy another browser profile or its cookies.
2. **Read-only discovery.** Run `pnpm organizer discover`, then `pnpm organizer plan`. Have the agent show representative conversation-title samples and estimated counts for every proposed Project; then review `.local/plans/taxonomy.yaml` and explicitly approve or customize it.
3. **Read-only extraction and classification.** Discovery contains metadata only. Run `node scripts/04-read.js --all` to extract messages into private `.local/raw/conversations/` checkpoints before running `pnpm organizer plan` again to produce `.local/plans/classification-input.jsonl`. This compatibility command is currently the read entry point. A missing or incomplete extraction blocks classification. Your Codex or Claude Code session processes the first/last-message input in bounded batches and writes schema-valid `.local/plans/classifications.json`. Additional excerpts require your explicit full-content permission and are limited to low-confidence items.
4. **Read-only plan review.** Run `pnpm organizer plan` to generate `.local/plans/migration-plan.json` and `.local/reports/review.html`. Review the taxonomy, every proposed action, unresolved items, and the displayed plan hash. A classification is never write authorization.
5. **Configure only reviewed write capabilities.** The example deliberately disables every write action. If the local config does not exist, copy it once:

   ```bash
   cp config/organizer.example.yaml config/organizer.yaml
   ```

   `config/organizer.yaml` is Git-ignored. Enable only the action flags required by the reviewed plan.

   - Set `allowCreateProjects: true` only when the plan contains a Project with `createRequired: true`.
   - Set `allowMove: true` only when the plan contains a conversation with `action: "move"`.
   - Set `allowArchive: true` only when the plan contains a conversation with `action: "archive"`.
   - Keep every unused action flag `false` and keep `neverDelete: true`.

   These flags are capability gates, not write approval, and they do not replace explicit approval of the exact unchanged plan hash.
6. **Explicit five-write pilot.** After approving the exact unchanged hash, run:

   ```bash
   organizer_plan_hash="$(node -p 'require("./.local/plans/migration-plan.json").planHash')"
   pnpm organizer apply --mode pilot --approve "$organizer_plan_hash"
   pnpm organizer verify
   ```

7. **Separate bounded resume.** Review the verified pilot. Only after a new explicit approval, resume the unchanged plan in the production batch limit (25 actions per invocation), then verify:

   ```bash
   pnpm organizer apply --mode resume --approve "$organizer_plan_hash"
   pnpm organizer verify
   ```

   Each successful batch verification returns to `APPLY_APPROVAL` while actions remain. Review results and obtain fresh exact-hash approval for each subsequent invocation. The final verification alone marks `COMPLETE`. Previously verified actions are not repeated. Any uncertain result stops the batch.
8. **Optional local cleanup.** After you no longer need the extracted data, run `pnpm organizer clean:data`. It prints every absolute target and requires the exact run ID. It preserves `.local/state` and the browser profile. To also remove the dedicated profile, run `pnpm organizer clean:data --include-profile` and complete the separate warning confirmation; you will need to log in again.

## Local data map

All user-derived artifacts are Git-ignored beneath `.local/`:

```text
.local/
├── profile/   dedicated Chrome session, including browser cookies
├── state/     run, account/workspace, approval, and progress state
├── raw/       discovered conversations, Projects, and extracted messages
├── plans/     taxonomy, classification input/results, and migration plan
├── reports/   local review report
├── audit/     append-only write and verification events
└── logs/      local diagnostic output
```

Only synthetic fixtures belong in Git. See [PRIVACY.md](PRIVACY.md) before sharing any artifact or asking a model to review full conversation content.

## Limitations

- v0.1 targets ChatGPT Web on macOS with Google Chrome. Claude Web history and other providers are unsupported and unverified.
- This is unofficial browser automation, is not affiliated with OpenAI, and can stop working when ChatGPT changes its UI or behavior.
- Browser selector checks and live writes cannot be made fully reliable by synthetic tests. Public CI never performs live writes.
- Discovery can resume from local checkpoints, but a safety stop always requires manual review before another approved write attempt.
- Cleanup is irreversible for the selected local artifacts and is intended for completed or deliberately abandoned runs.

For recovery guidance, see [Troubleshooting](docs/troubleshooting.md). Contributions are described in [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities according to [SECURITY.md](SECURITY.md), review data handling in [PRIVACY.md](PRIVACY.md), and see the [MIT License](LICENSE).
