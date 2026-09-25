# Form submission intake

Google Form → linked response sheet → installed Apps Script form-submit trigger → private Worker endpoint → existing D1 database → `/backstage/submissions`.

The page uses the existing Clerk staff allowlist. Only the write-only `/api/submissions/ingest` endpoint accepts the separate intake secret. That secret cannot read submissions, review them, or change broadcasts. Keep the sheet private; no Google credentials or webhook secrets belong in browser code or git.

## Release and connect

These are production changes and require release approval. Local implementation alone does not enable intake.

1. Apply `0004_submissions.sql` to the production database from `desk-worker`: `npx wrangler d1 migrations apply jettyradio-desk --remote`.
2. Generate a random secret with at least 32 characters. Store it using `npx wrangler secret put SUBMISSIONS_WEBHOOK_SECRET`. Deploy the Worker and website through the existing release process after approval.
3. Open the [response spreadsheet](https://docs.google.com/spreadsheets/d/1JWANaTg7HKQzrEQyqv1Y5ksioj-4sqUfu6-IBRDjwXw/edit). Under Extensions → Apps Script, add `Code.gs` from this directory as a new script file, preserving any existing scripts.
4. In Apps Script → Project Settings → Script Properties, set `JETTY_WEBHOOK_URL` to `https://jettyradio-desk.jettyradio-desk-api.workers.dev/api/submissions/ingest` and `JETTY_WEBHOOK_SECRET` to the same secret. Restrict script editing to trusted staff; script editors can access these properties.
5. Run `jettyInstallTrigger` and authorize the spreadsheet and outbound request permissions as the account that should own intake. Run it from only that account; trigger discovery only covers the current owner's triggers. It installs a spreadsheet “On form submit” trigger without replacing other triggers. Keep Google's trigger failure notifications enabled.
6. Run `jettyBackfill` until the execution log says “Backfill complete.” Each run sends at most 50 existing rows and saves its progress. Failed rows remain at the cursor for the next run. Do not sort or delete rows during this initial backfill; if rows moved, delete only `JETTY_BACKFILL_ROW` from Script Properties and restart. Replays are safe.
7. Verify an approved staff account can view the imported records, open audio/artwork links, mark one reviewed, refresh, and see the saved status. Confirm a fresh real form response arrives and an unapproved account is denied.

Google documents [spreadsheet form-submit events](https://developers.google.com/apps-script/guides/triggers/events#google_sheets_events) and [installed triggers and failure notifications](https://developers.google.com/apps-script/guides/triggers/installable). No public Apps Script deployment is needed.

## Behavior and recovery

- The mapping uses the nine column headers verified in the response sheet. Header changes or column moves fail visibly instead of silently mixing fields. Update `jettySendRow` if the form changes.
- Records are immutable snapshots. Their identity hashes the original submission timestamp and seven form columns (timestamp through notes). Sorting does not duplicate records; admin-column edits do not change identity. Identical content with the exact same timestamp is treated as a replay. Changed form answers imported later appear as a new submission needing review.
- The source sheet's pickup/completed fields are captured at first import, not continuously synced. Backstage review status is separate, and old completed rows initially still need review. No submission is auto-matched to a calendar slot, and no broadcast or source-sheet writes occur.
- The page fetches 50 records at a time with an explicit “Load older submissions” button. Search and status filters apply to loaded records; Refresh gets the newest submissions. Data is never included in the static site build.
- A trigger failure leaves the response in Google Sheets. Fix the cause shown in Apps Script Executions, then run `jettyBackfill` until complete; it can safely replay the full sheet. Trigger failures are not automatically retried by this integration.
- Review saves use revision checks so a teammate's concurrent review is not silently overwritten. Repeated webhook deliveries preserve reviews.
- To pause intake, disable the `jettyFormSubmit` trigger. To revoke its credential, replace the Worker secret and the Script Property together. Existing records stay available to staff.

## Local verification

Use `npx wrangler d1 migrations apply jettyradio-desk --local` in `desk-worker`, set a local-only `SUBMISSIONS_WEBHOOK_SECRET` in the ignored root `.env`, then run the existing local development command. Use synthetic submissions only when manually exercising local intake. Run the Worker type check/build, browser type check, and site build before release. The Apps Script production trigger must be verified after installation; local compilation cannot verify Google's trigger delivery.
