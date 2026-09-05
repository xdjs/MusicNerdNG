# MEMORY.md — Music Nerd engineering handoff

Updated 2026-09-04. Read this after `CLAUDE.md`. This is current state, not a changelog; use the
linked PRs, issues, and decision notes for history.

## Live and verified

- **Production / `main`:** [`#1200`](https://github.com/xdjs/MusicNerdWeb/pull/1200) merged as
  `db8ef758`. Main CI, the production deployment, and the post-deploy smoke workflow all passed on
  that release.
- **Database migrations 0022 and 0023:** applied and directly verified in both dev and production.
  `artist_interview_answers.sitting` is backfilled with no nulls; `offered_at` is `timestamptz`,
  backfilled, `NOT NULL`, and defaulted. The app role `mnweb` has SELECT/INSERT/UPDATE on both
  columns. RLS is enabled and the expected four `mnweb` policies are the only policies on the
  table. Owner/superuser success was not used as the access check.
- **Interview flow:** the repeatable, opt-in interview and research readiness work is live. A
  sitting is assigned when questions are offered and is not changed when answers are upserted;
  `offered_at` preserves offer time. See [`#1204`](https://github.com/xdjs/MusicNerdWeb/pull/1204)
  and the release PR above.
- **Repository hygiene:** [`#1210`](https://github.com/xdjs/MusicNerdWeb/pull/1210) keeps local
  Substack artifacts, local data, and the Discord layout scratch file out of Git. Durable public
  docs and agent reasoning remain tracked per `docs/rnd/README.md`.

## Staging differs from main

- `staging` is at `c67b409f`, one merged feature ahead of `main`:
  [`#1209`](https://github.com/xdjs/MusicNerdWeb/pull/1209) adds a fail-closed MusicBrainz artist-ID
  fallback and removes the two Claude GitHub Action workflows. It needs the normal staging-to-main
  release and production verification when the team chooses to ship it.
- There were no open PRs at the 2026-09-04 handoff. Old draft
  [`#1159`](https://github.com/xdjs/MusicNerdWeb/pull/1159) was closed without merging because its
  artist-research foundation overlaps the shipped research-job and resolver work. Do not revive
  its branch without comparing it to current `staging` and re-scoping it.

## Next work

1. **Artist-profile latest activity.** This is the agreed next product task: show interview answers
   ("nuggets") beside social updates, with a call to action back to the source post. The decision
   is in `docs/rnd/decisions.md`; the existing `ActivityFeed` is homepage-only, so the artist-page
   implementation has not been built. Define source-link behavior and test the display/query path.
2. **Release the staging delta when ready.** Create the next `staging` → `main` release for #1209,
   then verify CI, the production deployment, and post-deploy smoke on the merge SHA.
3. **Later product queue:** bookmarks, user-profile redesign, and the Dupes/YouTube-playlist
   prototype.

## Reliability and cleanup

- [`#1148`](https://github.com/xdjs/MusicNerdWeb/issues/1148): reconcile manual database state
  with Drizzle migration history before wiring `db:migrate` into deployment. This remains the most
  important migration-process debt.
- [`#1149`](https://github.com/xdjs/MusicNerdWeb/issues/1149): reconcile `schema.ts` RLS policy
  definitions with the live policies.
- Supabase reports GraphQL schema-discoverability warnings for `artist_interview_answers` because
  broad table grants exist. Direct verification found no `anon` or `authenticated` policy and no
  public row access; treat schema hardening as separate follow-up, not a release blocker.
- CI currently triggers the same workflow for both push and pull-request events. The resulting
  duplicate runs are redundant executions, not different tests; optimize later if queue time
  becomes a problem.
- Triage [`#1150`](https://github.com/xdjs/MusicNerdWeb/issues/1150): CI and post-deploy smoke now
  exist and passed for #1200, so the issue is at least partly obsolete.
- Other active debt: the Spotify client secret still uses a `NEXT_PUBLIC_` name and should move to
  a backward-compatible server-only variable; upload size remains tracked in
  [`#1151`](https://github.com/xdjs/MusicNerdWeb/issues/1151).
