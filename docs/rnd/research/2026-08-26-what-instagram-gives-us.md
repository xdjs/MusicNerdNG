# What Instagram gives us that a search engine cannot

Measured 2026-08-26 against the dev database. Two artists have been scraped so
far: Pete Rango (299 posts, 2018 to 2026) and Pharaoh Sistare (60 posts, 2023 to
2026).

Only aggregate counts and handles of artists already listed in the public Music
Nerd directory appear here. Individual accounts belonging to private people are
deliberately not recorded.

## The claim being tested

Everything else in the pipeline (Tavily, MusicBrainz, Spotify, Deezer) answers
the question "who is this artist and where are their accounts." None of it
answers "who do they actually work with." That second question is the one a
search engine is worst at and the one an artist's own feed answers directly.

## What the scraper stores per post

`socialIngest.ts` keeps, for every post: the owner's handle and whether the
artist authored it, co-authors, tagged users, mentions, hashtags, the reel's
audio credit (track title and credited artists), like/comment/play counts, the
timestamp, and the post URL. `is_own_post` is load-bearing: a scraped feed
includes posts authored by other people where the artist is a collaborator, and
attributing a foreign caption to the artist would poison every downstream claim.

## Result for Pete Rango

| signal | count |
| --- | --- |
| distinct accounts appearing anywhere in the feed | 487 |
| mutual collaborators (co-authored, or authored a post on his feed) | 46 |
| one-way mentions on his own posts | 467 |
| of those 487, already artists in the Music Nerd directory | **50** |

Those 50 are 50 edges in the artist graph that exist in no music database and
that no search for "Pete Rango" returns. They include Reo Cragun, Iman Europe,
Tangina Stone, Sam Gellaitry, KONA, The Park, Abjo, Xcelencia, Michael
Aristotle, Kiya Lacey, pat junior, Boy Untitled, Rosalie, Sound of Fractures and
Pharaoh Sistare, alongside accounts (Snoop Dogg, Drake, Travis Scott, Billy
Idol, Lil Baby) that are almost certainly reference rather than collaboration
and would need weighting before display.

Mutual collaboration is the stronger signal and it ranks differently from raw
mentions: the top co-authors are dameatlas (13 posts), deadsetfc (7), kevaux__
(7), liv.corp (6), rein.rocks (6), dear_rod (5), xuerecords (5). `rvamag` also
appears as a collaborator, which is the same RVA Mag relationship the article
search found separately.

### Reel audio credits

A signal with no equivalent anywhere else in the stack:

| credited artists | track | posts |
| --- | --- | --- |
| Dame Atlas, Pete Rango | crying on the floor (pete rango mix) | 6 |
| Pete Rango, Elle Symone | Dreamvibe | 3 |
| Lunch $pecial, Sneeze, Pete Rango | OH-KAY! | 3 |
| Pete Rango, Elle Symone | Breakdown | 3 |
| Pete Rango, Xmane | Planet X | 2 |
| MF DOOM | High John | 1 |
| Brian Eno | Signals | 1 |

The first five are credits, some of which (a named remix) may not exist as a
Spotify release at all. The last two are not his work: they are what he chose to
soundtrack a post with, which is taste rather than catalogue. Nothing else we
query distinguishes those two categories, and both are interesting.

### Collaboration over time

Co-authored posts by year: 0 through 2021, then 3 (2022), 8 (2023), 10 (2024),
2 (2025), 32 (2026). Instagram only shipped collab posts in late 2021, so the
early zeros are a platform artifact and not a career one. The shape after that
is real and is the kind of thing a profile could show.

## Correction: Pharaoh Sistare does not "post alone"

An earlier version of this note recorded Pharaoh Sistare as having zero
collaborators and inferred that this was why onboarding asked him no
Instagram-derived questions. Both halves were wrong, and the product owner
caught it by linking a single post.

What is true is that he has zero Instagram **coauthor tags**. What that measured
was a feature of the platform, not a fact about the artist. His collaborators are
named in the captions, in prose, with their roles stated:

| post | credit, in his own words |
| --- | --- |
| `/p/DScwWGzkYcJ/` | Mixing & Mastering Engineer: @p3t3rango |
| `/p/DIT-FmFRvK7/` | Mixed by @p3t3rango / Shot by @shesjasminmarie |
| `/p/DH9lnTWskPB/` | "my first single engineered by someone other than myself (the wonderful @p3t3rango)" |
| `/p/DL-vh9kS8Hh/` | @mickey_cheese_123 "playing the chord progression I had in my head", @gradylisiousness "my first bassist for all of my shows thus far" |
| `/p/DB9yRm6S_JN/` | feat. @jameir_thompson |
| `/p/DJU3-5OS4pu/` | Shot by @moneaofthemoon |

Twelve of his sixty captions carry a role credit next to a handle. We store every
one of them and reduce them to a flat `mentions` array that
`socialSignals.ts` then classifies as "weaker than a collaboration". A stated
role in the artist's own caption is stronger evidence than a coauthor tag, not
weaker. The ordering is backwards.

## Why onboarding asked him nothing: two separate defects

**1. The posts were not there yet, and that part is already fixed.** His claim
was approved 2026-08-21 at 11:46 and his feed was not ingested until 12:30, by
hand via `scripts/ingest-social.ts`. `generateGroundedQuestions` returns
immediately on `posts.length === 0`, so his interview ran against an empty table.
That was a real defect and it was diagnosed the same day: commit `9baf4d54`,
"actually ingest Instagram posts, so grounded questions fire", now kicks
`ensureRecentSocialPosts` when the profiles step is confirmed, two steps ahead of
the interview, with an 8s last-resort wait at the interview itself
(`SOCIAL_INGEST_WAIT_MS`). Before that commit the ingest only ever ran manually,
which is why grounded questions worked for artists whose posts had been seeded
by hand and for nobody else.

**2. Even with the posts present, the good material is not eligible.** Running
the real pipeline against his sixty stored posts today produces four candidates:
themes `single (11)`, `time (7)`, `song (6)`, and one standout post whose entire
caption is "I know you've got that somethin'" followed by twenty periods and
eleven hashtags. `GroundedQuestionKind` is `collaborator | theme | standout |
music`; `mentionedAccounts` is derived and then never becomes a question. The
prompt tells the model that returning zero questions is acceptable when nothing
clears the bar, and given that input, zero is the correct answer.

The full "My Dear" caption explains that he wrote a Christmas record about
spending the holidays without someone who has died, and who he wrote it for.
That is a complete artist statement. Our representation of it is the word
`single`, counted eleven times.

## The shape of the problem

`socialSignals.ts` is a word-frequency counter placed in front of a corpus that
is actually prose. It tokenizes captions and ranks terms, when the captions are
written statements containing named people, stated roles, and reasons. That was
the right design when reading ten thousand captions meant counting them. We have
a model that can read them.

This is the same defect recorded in
`2026-08-24-we-are-summarising-before-we-think.md`, one layer down: we compress
the source into a thin representation before anything capable of understanding
it gets a look.

## Where the signal currently goes

`socialSignals.ts` derives collaborators, mentioned accounts, themes, standout
posts and music references, and three consumers read it: `questionGenerator.ts`
(onboarding interview questions), `artistDocService.ts` (the knowledge
document), and `vaultWebSearch.ts` (discovery).

Nothing renders it. The richest thing we hold about an artist is currently
visible only as its own second-order effects.
