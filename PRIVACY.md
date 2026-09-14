# Privacy

ChatGPT Organizer is a local, agent-native repository. It has no maintainer-owned API key, hosted backend, telemetry, analytics, or maintainer-operated data service. The maintainer does not receive your ChatGPT history.

## Data read from ChatGPT

The ChatGPT adapter may read conversation identifiers, URLs, titles, timestamps, user messages, assistant messages, current Project locations, the visible Project list, and stable account/workspace markers needed to prevent cross-account writes. Progressive disclosure limits the first classification pass to titles, timestamps, and the first and last user messages. Additional excerpts are prepared only for low-confidence items after you allow full-content review.

## Local artifacts

All user-derived files stay under the Git-ignored `.local/` directory:

| Path | Contents |
| --- | --- |
| `.local/profile/` | Dedicated Chrome profile, including login state, cookies, and site storage |
| `.local/state/` | Run ID, account/workspace fingerprints, workflow phase, approvals, hashes, checkpoints, and apply progress |
| `.local/raw/` | Conversation and Project inventories plus extracted conversation content |
| `.local/plans/` | Taxonomy, classification input, classifications, and immutable migration plan |
| `.local/reports/` | Local HTML review report |
| `.local/audit/` | Append-only write and verification events |
| `.local/logs/` | Local diagnostic output |

The public repository contains only synthetic fixtures. Do not commit `.local/` content, legacy data directories, screenshots, reports, logs, or real conversation identifiers.

## Model-processing boundary

Semantic taxonomy and classification work is performed by your own Codex or Claude Code session under the account and privacy terms you selected for that runtime. Codex and Claude Code are agent runtimes, not history providers. The repository does not proxy model calls or send model input to the maintainer. Review your runtime's data settings before allowing additional excerpts or full conversation content into its context.

## Browser profile

Use only the dedicated profile created for this workflow and authenticate manually. Never copy another Chrome profile, cookies, tokens, or session files into the repository. The profile remains local but contains sensitive authentication material.

## Cleanup

`pnpm organizer clean:data` prints the exact absolute targets, asks for the current run ID, and removes only `.local/raw`, `.local/plans`, `.local/reports`, `.local/audit`, and `.local/logs`. It preserves `.local/state` and `.local/profile`.

`pnpm organizer clean:data --include-profile` adds the dedicated profile only after a separate warning confirmation. Removing it signs the workflow out and requires manual login again. Cleanup is irreversible for the selected local artifacts, so inspect or securely back up anything you are required to retain before confirming. Do not back up browser profiles or cookies to Git or an issue attachment.

## Sharing and bug-report redaction

Before sharing diagnostics, replace real data with the smallest synthetic reproduction. Remove conversation IDs, URLs, titles, messages, Project names, report rows, plan contents and hashes, run/account/workspace identifiers, profile paths, cookies, tokens, session markers, raw logs, and unredacted screenshots. Follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Unofficial automation risk

This project automates an evolving ChatGPT Web interface. A UI change can expose unexpected content, interrupt a write, or make location verification uncertain. The commands fail closed on known ambiguity, but no browser automation can eliminate all risk. Review the local plan, use the five-write pilot, verify every batch, and stop when the observed account, workspace, selector, or result is uncertain.
