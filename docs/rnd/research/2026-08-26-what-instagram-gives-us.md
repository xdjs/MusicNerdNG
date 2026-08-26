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

## Where it does not work

Pharaoh Sistare: 60 posts, **zero** collaborators. He posts alone, so the
strongest signal is empty and only the 29 one-way mentions remain, of which
exactly one (Pete Rango) is an artist we already have. Any feature built on the
collaborator graph has to degrade to something useful for an artist like this
rather than render an empty panel.

This is also the likely explanation for the earlier finding that onboarding
generated no Instagram-derived interview questions for him: there was no
collaboration to ask about.

## Where the signal currently goes

`socialSignals.ts` derives collaborators, mentioned accounts, themes, standout
posts and music references, and three consumers read it: `questionGenerator.ts`
(onboarding interview questions), `artistDocService.ts` (the knowledge
document), and `vaultWebSearch.ts` (discovery).

Nothing renders it. The richest thing we hold about an artist is currently
visible only as its own second-order effects.
