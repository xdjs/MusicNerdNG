# Demo runbook — 2026-08-27

The artist walks to their already-claimed profile on **staging** and runs
onboarding from a blank profile. Staging deploys against the **dev** database
(`kyhlkqriyvevjqtufidu`), so migrations already applied there are already
applied for staging.

Artists: **Pete Rango** and **Pharaoh Sistare**.

## Migrations

Applied to dev (= staging) already: **0017**, **0018**, **0019**. Prod has none
of them, and prod is still missing 0011-0016 from earlier work.

0018 needs its `GRANT` as well as its RLS policies. A policy filters rows only
after Postgres has checked that the role may touch the table at all, so a policy
without a grant permits nothing, and every credits query fails in a way the
catch blocks turn into an empty result. Dev has default privileges that hid
this; nowhere else necessarily does.

## Before the demo

1. **Merge PR #1179 to staging** once CI and the reviewer are both green on
   HEAD. Nothing below works without it: staging at `95a82400` scores 1-2 of 18
   on link discovery and has no caption reader.
2. **Confirm the staging deploy finished** before touching any artist record.
3. **Reset both artists**, keeping the pre-warmed caption credits:

   ```
   npm run onboarding -- "Pete Rango" blank --keep-credits
   npm run onboarding -- "Pharaoh Sistare" blank --keep-credits
   ```

   `blank` clears every platform link including Spotify and Deezer. Links are
   backed up to `.superpowers/backups/links-<id>.json` first; `npm run
   onboarding -- restore "<name>"` puts them back.

   `--keep-credits` matters. Extraction is a background job that takes about
   five minutes on a 300-post feed and a walkthrough reaches the interview in
   about two, so clearing them means the interview asks the three generic
   questions instead of asking about a named collaborator.

4. **Walk both runs end to end first.** Not optional.

   This needs the artist's own login, so it cannot be done unattended — the
   useful split is one person driving the browser while the other watches
   `[vaultWebSearch]` and `[socialCredits]` in the server log and reads the
   database between steps. Reset again afterwards.

   Nothing in the UI has been clicked through. Discovery is measured hard;
   the chat, the profiles step, the vault step and the interview are not.
   That is where the remaining demo risk lives.

## What blank should find

Measured 2026-08-26 with `npx tsx scripts/research-benchmark.ts pete pharaoh
--blank`, which clears the DSP ids too:

| artist | links |
| --- | --- |
| Pharaoh Sistare | 5/5 correct |
| Pete Rango | 5/7 correct |
| | **10 correct, 0 wrong, 2 missed** |

No wrong links and no namesakes in the hardest configuration the pipeline can
face: no identifier for MusicBrainz to match on, no catalogue to corroborate
against, nothing but a name. The two misses are recall.

## What the interview should ask

From pre-warmed credits, not from counted words. Pharaoh Sistare's run
produced:

> You've credited @p3t3rango as your mixing and mastering engineer on several
> tracks; what's that collaborative process typically like when you're working
> together?

Zero theme questions survived, which is the intended behaviour: given real
material the interviewer stops reaching for frequent words.

## Known rough edges, in case they come up

- **The knowledge document is still only visible in edit mode.** Everything the
  pipeline researches is invisible on the public profile.
- **The collaborator graph is not rendered anywhere.** 50 of the 487 accounts in
  Pete Rango's feed are artists already in the directory, and nothing shows it.
- **Extraction is not exhaustive.** Coverage is logged as covered/total captions
  and the sweep pass recovers most of the gap, but a caption can still be
  missed. Every count is a floor.
- **Some statements are very personal.** The extraction surfaces grief and
  mental health from public posts. Nothing improper was collected, but nothing
  should be published without the artist approving it first — that is the open
  design question behind the opt-in interview.

## If discovery underperforms live

Seed Spotify before the run and re-reset. That is the configuration the
benchmark measured at 16/18 rather than 10/12, and it is a one-line change:

```
npm run onboarding -- "<name>" deezer-only --keep-credits
```

then set `spotify` back by hand from the backup file.


## What review found, and what it means for the demo

Four rounds of review on this branch, each finding problems in the previous
round's fixes. The ones that would have shown up in front of an audience:

- **A wrong Instagram link.** A second account whose display name is exactly
  "Pharaoh Sistare" passed verification, because "does this page name the
  artist" is a question an impostor answers correctly. Now blocked by comparing
  against the handle the artist's own scraped posts are authored by.
- **A lookalike domain could donate its links.** `isArtistOwnDomain` was a
  substring test, then a leftmost-label test, and is now a registrable-domain
  comparison. `artist-fans.example` and `artist.attacker.example` both fail.
- **The affirmed-account path could overwrite a confirmed link**, being the one
  adoption path that never checked whether the platform was already set.
- **Phase budgets summed past the caller's 45s cap**, so the vault step could
  re-read a half-written vault and show the artist that while discovery kept
  writing behind them.

Two that do NOT affect the demo, because both artists are pre-warmed, but which
would hit every real artist:

- The primary onboarding flow (`runAutoBuild`) never ingested a feed or read a
  caption at all.
- On that flow the document was always written before the credits arrived, so
  it cited none of them.

## Numbers, and how much to trust them

`--blank`, Pete Rango and Pharaoh Sistare: **10 correct, 0 wrong, 2 missed of
12**. That figure is post-fix and re-measured.

Caveat on everything else: the benchmark ignored its own `seed` field for the
DSP columns until this branch fixed it, so any *seeded* number reported before
that was measured with Spotify and Deezer present when the case said otherwise.
The blank numbers are unaffected — blank clears everything explicitly.
