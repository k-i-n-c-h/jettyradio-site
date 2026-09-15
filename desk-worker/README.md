# Jetty scheduling desk backend

The Astro page at `/backstage/desk` calls this Cloudflare Worker. D1 stores private plans; a restricted AzuraCast key stays in a Worker secret. The public repository must contain no submission records or credentials.

## Current deployment

- Worker: `https://jettyradio-desk.jettyradio-desk-api.workers.dev`
- Personal Cloudflare account: Mariel Freyre
- D1: `jettyradio-desk`; migrations are in `migrations/`.
- Access deliberately remains closed until the production Clerk instance is verified and its user IDs are approved.

## Development and checks

From `desk-worker`, run `npm ci` and `npm run check`. Run `npm run build` to validate the Worker bundle without deploying. From the site root, run `./desk-worker/node_modules/.bin/tsc -p src/lib/desk/tsconfig.json` for the browser client. The full Astro build requires the existing archive-read `AZURACAST_API_KEY` and `PUBLIC_CLERK_PUBLISHABLE_KEY`.

Copy `.dev.vars.example` to ignored `.dev.vars`. Configure the local Clerk issuer, approved development user IDs, verification public key, and localhost origins there. Omit the AzuraCast key for local testing without live station writes. Run `npm run dev` in this directory and the Astro dev server in the site root. Set the site's ignored `.env` `PUBLIC_DESK_API_URL` to the local Worker URL.

## Production release

1. Use the existing Jetty Radio production Clerk application (`app_3D15hcu4pamOV5rIVa5Kwq7XnVh`, instance `ins_3FmZ7vL7amnulcEotJHPkWCoSNj`). Dashboard access is confirmed. The production website is invite-only; the scheduler's invitation must be accepted after DNS is repaired. Dashboard collaborators and personal development users are not production website users.
2. Configure the five CNAMEs below in DigitalOcean DNS. On September 14, 2026 all five names resolved to `jettyradio.com`; Clerk reported them unverified and SSL certificates not issued. Add explicit records, replacing any conflicting record at the same name. Verify the records in Clerk and confirm HTTPS before enabling access.
3. Set `CLERK_ISSUER`, exact `ALLOWED_ORIGINS`, and explicitly approved production `CLERK_ALLOWED_USER_IDS` in `wrangler.jsonc`. Store `CLERK_JWT_KEY` (PEM public verification key) and the restricted `AZURACAST_API_KEY` with `wrangler secret put`, or as encrypted secrets in Cloudflare's dashboard. Never use a Super Administrator station key.
4. Apply migrations with `npx wrangler d1 migrations apply jettyradio-desk --remote`, then deploy with `npm run deploy`. The current database and restricted station secret are already provisioned. Wrangler preserves secret bindings across deployments.
5. Verify an approved production account can read and save a plan; verify unapproved accounts cannot. Verify media and playlists load. Confirm writes against an isolated, disabled playlist before a real episode is scheduled.
6. Set the GitHub repository variable `PUBLIC_DESK_API_URL` to the Worker URL. Keep the existing production Clerk publishable key. Release the website only after authorization and successful checks; pushing main triggers GitHub Pages deployment.

| CNAME name within `jettyradio.com` | Target from production Clerk |
| --- | --- |
| `clerk` | `frontend-api.clerk.services` |
| `accounts` | `accounts.clerk.services` |
| `clkmail` | `mail.hngf2ztshz5s.clerk.services` |
| `clk._domainkey` | `dkim1.hngf2ztshz5s.clerk.services` |
| `clk2._domainkey` | `dkim2.hngf2ztshz5s.clerk.services` |

## Behavior and limits

- Saving a plan does not change the broadcast. D1 revision checks reject stale saves; the scheduling request also checks the reviewed plan revision and live playlist schedule.
- A show owns an existing recurring playlist and media directory. Each dated episode plan owns an MP3 link, artwork link, tracklist, review checks, and attached media ID. The stored `shows` array retains its name for existing plans.
- The form follows four steps: confirm the date/time; review audio and artwork; upload the episode MP3; schedule in AzuraCast. Artwork can be dropped into the form or selected with the image picker. Scheduling saves show name, artist, tracklist as lyrics, and air date in MM/DD/YYYY; uploads the selected artwork (or imports the saved Drive link); moves the MP3 to the existing show directory; then enables the existing recurring playlist with blank start/end dates.
- Submission requires a ready review, future Pacific slot, and a disabled playlist with exactly one matching recurring entry and no other media. Audio may exceed the slot by up to 15 seconds; a missing or invalid duration blocks submission separately. The recurring weekday and times are preserved. Known active playlist overlaps are rejected; live DJ conflicts require manual review.
- After scheduling, the scheduler still updates the source response sheet and sends resident confirmation. After airing, the form’s Archive episode button adds the saved MP3 to Jetty’s Archives and heavy rotation playlists, removes its show assignment, checks the confirmed air date in MM/DD/YYYY format, and disables the show playlist. The file stays in its existing folder, and other playlist assignments and metadata are preserved.
- Archiving becomes available after the Pacific slot ends plus the 15-second audio allowance. It rejects stale plans, missing or changed media, conflicting air dates, and show playlists containing another episode. It verifies the media changes before disabling the playlist and marks the desk episode Archived only after confirmation. A partial change can be retried after checking AzuraCast; a concurrent desk save is preserved and reported separately.
- Direct MP3 imports read the saved Google Drive link using bounded byte ranges on the backend; audio bytes do not pass through the browser. Uploading is available before review checks are complete; the checks gate scheduling. Private/download-blocked files require downloading the linked MP3 manually and using the form fallback. Saved artwork currently requires a directly downloadable Drive JPEG or PNG; a failed artwork import stops submission before playlist activation.
- A selected JPEG or PNG up to 10 MiB travels with the final scheduling request and takes priority over the artwork link; it needs no Drive sharing changes. The backend validates its filename against the saved review, format, signature, and size before station writes. Changing the image clears its review checkbox. Drafts store the image name, not its bytes; reopening the form requires selecting and reviewing it again. The image is sent to AzuraCast only when scheduling is submitted.
- Before uploading, the scheduler can edit an MP3 name that defaults to the show and air date. Both Drive imports and computer uploads use that name, normalized to lowercase letters, numbers, and hyphens, followed by a unique upload ID. The desk previews the filename and displays the actual saved filename after uploading. Existing uploads keep their filenames.
- Uploads use 1 MiB chunks, up to 512 MiB per MP3. Files start at station root, without folder-based automatic playlist assignment. A successful final response requires a matching media record. Interrupted uploads may leave temporary chunks or an unconfirmed uploaded file; reload station media before retrying.
- Local production integration tests verified media/playlist reads and a two-chunk unassigned MP3 upload. The two test media files were removed with the administrator session because the restricted integration role cannot delete media. Hosted production sign-in and the complete production workflow still need verification.
- AzuraCast changes are not transactional. If assignment succeeds but enabling fails, inspect the disabled playlist before retrying. The desk never promises rollback of an uncertain broadcast response.
- The Worker serializes desk scheduling and archiving requests with the same station lock; people editing directly in AzuraCast are outside that lock.
- Opening or changing a week checks the same public Google Calendar feed used by the schedule page and adds missing draft episodes with Pacific air dates, times, show names, and artists. No Google login is required. Recurrences, exclusions, moved occurrences, and cancellations are applied when creating episodes; existing drafts, submissions, and archived records are retained. Calendar changes never overwrite a saved time or delete an episode; mismatches and overlapping or overnight slots require manual review. Stable calendar identities prevent duplicates, including after editing an episode, and concurrent saves are merged with revision checks. The plan remains capped at 500 episodes.
- Google Form ingestion is available as an opt-in cron import; see Automatic form submissions below. Existing email notifications remain separate. Calendar drafts begin Awaiting audio, and reviews still require a scheduler.

## Recovery

Keep the existing hosted desk available until the website replacement is verified. For a backend regression, use Cloudflare's deployment rollback and inspect D1 before changing data. Back up D1 before destructive migrations. To stop station writes, remove/revoke the restricted AzuraCast key. To close all desk access, clear `CLERK_ALLOWED_USER_IDS` and deploy.

## Automatic form submissions

The desk can poll the existing Google Form response sheet once per minute. It reads the nine columns in `Form Responses 1!A:I`, verifies their headers, and uses the immutable response timestamp as its identity. Renaming or sorting a response does not create a second upload; duplicate timestamps stop the poll for review. The first successful poll records existing responses as a baseline and uploads none of them. Only later responses enter the queue. Do not change response timestamps or switch the configured sheet/tab after initialization without a migration.

The form has no air-date field. Import matches the complete `Show w/ Artist` label (ignoring case and repeated spaces) against exactly one future calendar episode in the next 14 days. Calendar drafts refresh automatically. Multiple possible dates, unknown names, unsupported links, and existing scheduler edits go into Unassigned files at the top of the desk. Choose the correct episode there to resume an import. A unique disabled playlist matching the show title or full label and a unique folder matching the show title are preselected; missing playlist/folder matches remain in that section until selected in the episode form.

MP3s and JPEG/PNG artwork are downloaded through the Drive API, allowing private files shared with the service account. Audio uses the existing 1 MiB uploader, with at most eight chunks per poll and a persistent upload ID. An interrupted upload resumes without creating a second MP3. The Drive file version is checked before resuming and before attaching the result. Changed files, inaccessible artwork, and concurrent episode edits stop the import for manual review. Retry restores a stopped import only after its underlying problem is resolved; replacement files use the existing manual upload flow.

Imported audio remains at the station root with no playlist assignment; artwork is attached to that media record. The desk saves audio/artwork links, tracklist, and submission notes, but leaves all review checks unset and status Draft. Scheduling still performs metadata/folder/playlist writes after review. No automatic playlist activation, response-sheet status changes, or resident emails occur. The station lock serializes imports with scheduling and archiving; direct edits in AzuraCast remain outside that lock.

### Enable in a test environment

1. Use Node 24 for `npm test`. Apply D1 migrations, including `0002_submissions.sql`, to the environment being tested.
2. Create a Google service account with the Sheets and Drive APIs enabled. Share only the response sheet and submitted asset folders/files with that account as Viewer; no domain-wide delegation is needed. Individual externally owned files must also grant it read/download access.
3. Store the service-account JSON as the encrypted Worker secret `GOOGLE_SERVICE_ACCOUNT` (`wrangler secret put GOOGLE_SERVICE_ACCOUNT`). Never commit the JSON or paste it into frontend configuration.
4. Set `SUBMISSIONS_SHEET_ID` and `SUBMISSIONS_SHEET_TAB` to the test response sheet. Keep its nine form columns in A:I. Configure the existing restricted AzuraCast key and approved Clerk accounts for that environment.
5. Set `SUBMISSIONS_ENABLED` to `true` only after the above setup. It defaults to `false` in the repository. Deploying with that default does not read Google or upload files. Disabling it pauses cron imports and manual import assignment; existing drafts remain available.
6. Wait for the first successful poll, shown under Unassigned files, before adding a new test response. The initial responses are intentionally skipped. At most ten new/changed responses are queued and one import advances per poll; MP3s larger than 8 MiB take multiple polls. Refresh submissions to see progress.

For local testing, run `npm run dev -- --test-scheduled` and trigger the local `/__scheduled` endpoint. Keep credentials pointed at the designated test resources. Production setup and a full live import still need operator verification.

### Manual acceptance checks

- Add a fresh matching response after baseline initialization; verify its calendar episode gains the audio link, artwork link, notes, tracklist, and uploaded MP3. In AzuraCast, verify artwork and an unassigned root-level MP3; the show playlist must remain disabled.
- Confirm the desk still requires date, audio, and artwork review before scheduling. Reload twice and trigger another poll; there must still be exactly one media record.
- Submit a misspelled show name or use two upcoming occurrences of the same show. Confirm Unassigned files explains the mismatch and shows links to the source assets. Select the correct episode and choose Assign and upload; verify it enters the upload queue.
- Remove/rename the matching playlist or folder in the test fixture. The imported episode should remain visible in Unassigned files until a scheduler chooses its playlist and folder.
- Deny artwork access, then restore it and click Retry import. Verify the existing MP3 is reused. Change the MP3 during a partial upload; verify attachment stops and the error requests manual replacement.
- Edit an episode during import. Verify scheduler edits survive and the item reports a conflict instead of overwriting the episode.
- Mark a new response Completed before discovery; it must not upload. Disable intake and verify no new submissions are imported.

Automated checks: `npm test`, `npm run check`, `npm run build`, plus the browser-client TypeScript command above. Tests use in-memory SQLite and mocked Google/AzuraCast APIs; they make no live station writes.

API references: [Google service-account authentication](https://developers.google.com/identity/protocols/oauth2/service-account), [Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get), and [Drive downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads).
