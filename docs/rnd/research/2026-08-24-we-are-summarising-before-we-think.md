# ChatGPT beat us with a prompt. Here is why.

Pete, 8/24, after asking ChatGPT what it knew about the scene around Pete Rango and getting back a
ranked fifteen-artist map with a listening path: *"we're engineering for the old century when
we're in the age of AI."*

He is right, and the numbers are worse than the impression.

---

## It is not retrieval

Sixteen of the eighteen artists ChatGPT named are already reachable from data we hold today.

| | spotify | our sources | instagram |
|---|---|---|---|
| Cherele | yes | yes | yes |
| Elle Symone | yes | — | — |
| Dame Atlas | yes | — | yes |
| Nia Sultana | — | yes | — |
| Kilo Kish | — | yes | — |
| Jesse Boykins III | — | yes | — |
| Father, KeithCharles, Fousheé | — | yes | — |
| Ty Symph | yes | — | — |

Only **Yonder** and **CAS** are genuinely missing. We are not short of information.

## We publish 489 characters of it

```
public About          489 chars
knowledge document  5,153 chars   owner-only, behind an Edit button
ChatGPT's answer   ~4,600 chars   public, readable, ranked
```

We already write something the same size as the thing that beat us. Nobody can read it. Then we
publish a four-sentence summary of it.

## And we summarise before the model is allowed to think

```
what we hold about one artist        123,812 chars
Gemini 2.5 Flash context window    4,000,000 chars      →  we use 3.1%

98,138 chars of his own writing, 2018-2026    →   7 bullet points
38 posts where he tagged people, over 8 years →   4 handles
```

`MAX_COLLABORATOR_SOURCES = 4`. `MAX_MUSIC_REF_SOURCES = 8`. A 12,000-character budget per source.
Six discography entries. `deriveSocialSignals` reducing eight years of posts to a dozen labels.

Every one of those caps was written as though context were scarce. It is not. We could hand the
model everything we have about him thirty times over.

**That is the old century: distil hard, hand the model a summary, get a summary back.**

## The rules that made it careful also made it dead

The document prompt is a list of prohibitions — no hype, do not inventory, do not characterise
beyond the evidence, no format words, at most six entries, every entry must justify itself. Each
was a correct fix for real bad output. Together they produce prose nobody would read.

> "Cherele sits in that colorful, left-field alternative-rap space — South Florida energy,
> internet-era rap, pop instincts"

That violates several of our rules. It is also the best sentence in the comparison and the one
most likely to make someone press play.

**"Do not invent" and "do not characterise" got collapsed into one rule.** The first is
non-negotiable — it is what keeps a film soundtrack's Wikipedia page off an artist's profile. The
second was collateral damage, and characterising is the product.

## What we have that a prompt cannot

ChatGPT sees released credits: a lagging, sparse signal. It cannot see:

- **Eight years of the artist writing in their own voice.** His cousin André handing him 112's
  *Part III* and Dr. Dre's *2001* — the first modern R&B he heard, and an origin story absent from
  every interview. His mother bringing him and his brother to the US. A year producing
  @cocomamba's *Neptune* in 2018. Why he believes in Subvert.
- **A relationship graph with time and intent.** 38 posts tagging collaborators across 2018-2026 —
  who he was working with *when*, including everything that never became a release.
- **The artist themselves.** Corrections that outrank any source, and answers to questions we ask.
- **Provenance.** Every claim traceable to a page, with its publication date.

We use almost none of the first two.

## The inversion

Today, code does judgment — tiers, slug derivation, probe heuristics, relevance thresholds, caps,
filters — and the model receives a pre-chewed list. It should be the other way round.

**Code should do what code is good at:** fetch and store completely, verify a URL resolves, match
an ID exactly, attach provenance, enforce the artist's corrections, refuse to invent.

**The model should do what it is good at:** read all of it, find what connects, rank by evidence,
and tell it to a person who wants a way in.

## Order of work

1. **Publish the document.** The material exists and is hidden behind an Edit button as a
   maintenance UI. This is the cheapest large gain available and it is not an engineering problem.
2. **Give the model the corpus.** Stop distilling 299 posts into 7 labels. Hand it the posts with
   dates, the sources whole, the catalog with release dates, and let it find the story.
3. **Let it characterise.** Keep every rule that prevents invention. Drop the ones that prevent
   voice. Write for a reader, not for a downstream function.
4. **Then the graph.** Spotify's credits give a closeness ranking from release evidence rather than
   vibes — the one thing ChatGPT had to hedge by hand ("outer ring / demo connection") that we
   could actually know. But a graph with nowhere to live is just more machinery.

The order matters. Doing 4 first is the mistake we keep making.
