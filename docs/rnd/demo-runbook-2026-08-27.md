# Demo runbook — 2026-08-27

The artist walks to their already-claimed profile on **staging** and runs
onboarding from a blank profile. Staging deploys against the **dev** database
(`kyhlkqriyvevjqtufidu`), so migrations already applied there are already
applied for staging.

Artists: **Pete Rango** and **Pharaoh Sistare**.

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

4. **Walk both runs end to end yourself first.** Not optional. Reset again
   afterwards.

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
