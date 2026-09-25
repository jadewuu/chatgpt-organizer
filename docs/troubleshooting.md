# Troubleshooting

The safe default is to stop. Do not copy browser profiles or cookies, improvise ChatGPT clicks, edit plan/state hashes, or bypass account/workspace and approval gates to make a command continue.

## Chrome is not found

Run `pnpm organizer doctor`. Install Google Chrome in the standard macOS Applications location, or set `ORGANIZER_CHROME_EXECUTABLE` to the absolute path of a trusted Chrome executable and rerun the doctor. Do not point the organizer at an existing personal profile.

## Login expired or the login page reappears

Run `pnpm organizer login` and authenticate manually in the dedicated Chrome window. Login is not write approval. Never copy cookies, tokens, session files, or a profile from another browser; if the account or workspace marker differs, stop and confirm that you selected the intended account.

## No sidebar or Project list is visible

Stop the workflow and check ChatGPT itself in the dedicated profile. Confirm that the intended account/workspace has access to the expected sidebar and Projects, then rerun the read-only check. Do not manufacture missing Projects in the browser or continue a write with an unverified destination.

## A selector is missing or ambiguous

Treat this as a possible ChatGPT UI change. Stop; do not replace the selector with an ad-hoc click. Capture only redacted structural details, create a synthetic reproduction when possible, and follow `SECURITY.md` if the failure could cross an account or data boundary. Resume only after the adapter and tests have been safely updated.

## ChatGPT shows a rate limit or access restriction

Stop immediately. The organizer intentionally does not retry rate-limited writes. Wait until the service is available, then re-check the account, workspace, unchanged plan hash, persisted progress, and current item location before requesting a new approved resume. Never automate a cooldown loop around an access restriction.

## Discovery or conversation reading is partial

Keep the browser and coding agent stopped if the page state is uncertain. `pnpm organizer discover` gathers metadata; `node scripts/04-read.js --all` extracts messages and reuses only complete validated checkpoints. Classification refuses missing or incomplete extraction. The conservative extraction contract currently supports a native text-message branch whose content exactly matches two stable rendered observations. Unsupported attachments, tools, formatting differences, incomplete responses, or unstable renders stop extraction; they are not saved as complete. Inspect `.local/raw/` only on your machine. Do not fill gaps by editing inventory IDs or copying raw data into tracked files.

## Stable unique workspace identity is unavailable

The experimental adapter has no accepted authenticated native workspace-ID contract yet. It deliberately blocks account-bound reads and writes. A visible label, including “Personal,” cannot distinguish workspaces. Preserve the stop and wait for a reviewed adapter update backed by authenticated contract evidence; do not invent an ID, patch state, or bypass the identity check. Synthetic workflow tests are not live acceptance.

## The plan hash changed or approval is rejected

Do not reuse the old approval and do not edit the hash in either the plan or state. Before any writes, edit `.local/plans/taxonomy.yaml` or `classifications.json` and rerun `pnpm organizer plan` in `PLAN_REVIEW`. It invalidates prior approvals and regenerates the hash and report. Confirm every changed action and approve the new exact hash only if correct.

Once any write may have begun, do not regenerate or edit the old plan/state. Preserve the entire old `.local` run and its audit in a private location outside Git, reconcile the actual account state through a reviewed read-only adapter after its contract is accepted, and deliberately abandon the old execution before starting a separate fresh workflow with new discovery, classification, plan review, and a new pilot. Never copy old approvals/progress into the new run or manually mark uncertain work complete. Unchanged plans with successful batch verification can continue through the normal fresh-approved resume path.

## The account or workspace does not match

Stop without writing. Confirm the intended ChatGPT account and workspace in the dedicated profile. If you intentionally changed context, start a fresh read-only workflow and generate a new plan for that context; do not alter fingerprints, reuse the previous plan, or copy session material between profiles.

## A write or verification is uncertain

Do not retry the item or mark it complete manually. Inspect the current ChatGPT location using the supported adapter, preserve the local audit/state files, and resolve the uncertainty before another approved batch. Previously verified actions can be skipped only when the persisted progress for the same unchanged plan says they are done.

## Cleanup was cancelled, failed, or run too early

A confirmation mismatch removes nothing. A filesystem error stops at the failed target and reports it; do not replace the command with a broad recursive deletion. Resolve permissions or the unexpected path and inspect what remains before running the command again.

Cleanup is irreversible for `.local/raw`, `.local/plans`, `.local/reports`, `.local/audit`, and `.local/logs`. It preserves `.local/state` and the dedicated profile by default, but the removed plan and raw data cannot be used to resume. If you cleaned an unfinished run, do not reconstruct its artifacts or patch its state. Securely retain any state you are required to keep, move the old `.local` run aside outside Git, and begin a new workflow from preflight and read-only discovery. If `--include-profile` was confirmed, run `pnpm organizer login` and authenticate manually again.
