# Jetty scheduling desk backend

The Astro page at `/backstage/desk` calls this Cloudflare Worker. D1 stores private plans; a restricted AzuraCast key stays in a Worker secret. The public repository must contain no submission records or credentials.

## Current deployment

- Worker: `https://jettyradio-desk.jettyradio-desk-api.workers.dev`
- Personal Cloudflare account: Mariel Freyre
- D1: `jettyradio-desk`; migrations are in `migrations/`.
- Access deliberately remains closed until the production Clerk instance is verified and its user IDs are approved.

## Development and checks

From `desk-worker`, run `npm ci` and `npm run check`. Run `npm run build` to validate the Worker bundle without deploying. From the site root, run `./desk-worker/node_modules/.bin/tsc -p src/lib/desk/tsconfig.json` for the browser client. The full Astro build requires the existing archive-read `AZURACAST_API_KEY` and `PUBLIC_CLERK_PUBLISHABLE_KEY`.

Run `npm run setup` from the site root to install both apps, create the ignored root `.env` if missing, and apply local D1 migrations. Fill in the Clerk development settings and approved user IDs in `.env`, then run `npm run dev` from the root to start Astro and the Worker together. See the root [README](../README.md#making-changes) for the settings and commands. Both apps read the root `.env`; setup preserves existing values. Leave `AZURACAST_API_KEY` empty for local testing without live station writes.

For the Worker alone, run `npm run dev` in this directory. For a Worker bundle check without deploying, run `npm run build`.

If migrating an existing checkout, move settings from `desk-worker/.dev.vars` into the root `.env` and remove `.dev.vars`; the dev command now explicitly loads the root `.env`. Production configuration remains in `wrangler.jsonc` and Cloudflare secrets.

## GitHub deployment

The existing `.github/workflows/deploy.yml` builds the site, checks and deploys the Worker, then publishes GitHub Pages. Once the required deployment settings are configured, a failed backend deployment prevents publishing the new frontend. Production runs are serialized; only `main` can deploy. Pushes to `main`, the daily rebuild, and manual runs on `main` all use this sequence.

Before merging this workflow, configure repository Settings → Secrets and variables → Actions:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API token permitted to deploy Workers in the Jetty account. Start with the Edit Cloudflare Workers template and restrict it to that account. |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Account ID containing `jettyradio-desk` and its D1 database. |
| Variable | `CLERK_ALLOWED_USER_IDS` | Comma-separated approved production Clerk user IDs. The workflow overrides the empty checked-in allowlist. |
| Variable | `PUBLIC_DESK_API_URL` | `https://jettyradio-desk.jettyradio-desk-api.workers.dev` |

Keep the existing website secrets `AZURACAST_API_KEY` and `PUBLIC_CLERK_PUBLISHABLE_KEY`. The Worker's `CLERK_JWT_KEY` and restricted `AZURACAST_API_KEY` remain in Cloudflare; deployments preserve them. Until all four deployment settings are present, the workflow warns and skips the Worker deployment while allowing the website to publish. The existing Worker is unchanged. Adding all four settings automatically enables Worker deployment on the next run; a real Worker deployment failure then blocks website publication. Database migrations remain an explicit release step. Apply pending migrations before deploying features that depend on them. A Pages failure after the Worker deploys does not roll back the Worker.

Cloudflare authentication setup: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

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
- Google form/email ingestion is not wired into this Worker. Existing submission notifications remain separate. Calendar drafts begin Awaiting audio; submission links and reviews still need to be entered in the desk.

## Reconciling episodes managed in AzuraCast

Choose the episode’s week, or add an episode if it is not in the desk. Confirm its air date/time, then open Episode audio → Use an MP3 already uploaded to AzuraCast. Find and select the MP3 and its existing show playlist, then choose Reconcile with AzuraCast. The submission link and artwork are optional for this path.

Reconciliation only reads AzuraCast and updates the desk using revision checks. It rejects conflicting file air dates and MP3s already linked to another desk episode. A matching enabled schedule is marked scheduled; other show assignments remain MP3 attached and can still be archived after airing. A completed external archive is recognized only when both archive destinations, the confirmed air date, and a disabled show playlist agree. Use the episode row’s Archive button to open a separate form that confirms air date/time, MP3, and show playlist. It reconciles newly selected media before archiving; existing attachments retain the archive retry checks. The Schedule form contains no archive controls.

Run `node --test desk-worker/src/*.test.mjs` from the site root for scheduling and reconciliation rules.

## Recovery

Keep the existing hosted desk available until the website replacement is verified. For a backend regression, use Cloudflare's deployment rollback and inspect D1 before changing data. Back up D1 before destructive migrations. To stop station writes, remove/revoke the restricted AzuraCast key. To close all desk access, clear `CLERK_ALLOWED_USER_IDS` and deploy.

## Episode genre tags

The Episodes table edits title, artist, air date, and tracklist / notes in AzuraCast. The air-date picker writes the existing `air_date` custom field in MM/DD/YYYY format, preserving other custom fields; leaving the date unchanged preserves its stored value. Genre tags live in D1: `episode_tag_bank` holds reusable names and `episode_tags` links multiple tags to each AzuraCast media ID and path. The bank starts empty; staff can use the plus button beside an episode to open its details form, choose from the shared bank, or create genres. Names are normalized to lowercase, limited to 40 characters, and each episode supports up to 20 tags. Removing a tag from an episode keeps it in the bank. Genre filtering is integrated into the search bar and matches every selected tag and combines with search and playlist filters. “Untagged only” clears selected tags; selecting a genre turns that option off.

Apply `0003_episode_tags.sql` before releasing this feature (`npx wrangler d1 migrations apply jettyradio-desk --local` for development; use `--remote` only for an approved production release). Episode details and tags span two services: if details save but the tag write fails, the editor reports this and retains the draft for retry.
