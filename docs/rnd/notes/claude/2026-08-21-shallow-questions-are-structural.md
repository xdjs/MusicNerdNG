# The questions are shallow because of how they're derived, not how they're worded

Pete, 2026-08-21, on a generated question — *"You often use the word 'single' in your captions;
is there a particular strategy or philosophy behind focusing on individual track releases?"*:

> the questions are to add depth to the artist' story. your question about "single" in your
> captions is so shallow and has no depth. we should be finding out more about the artist

He's right, and the fix isn't prompt wording.

## What the pipeline does today

```
posts  →  countable signals  →  questions
          (word counts, hashtag counts,
           engagement outliers, audio credits)
```

`deriveSocialSignals` reduces every post to things that can be counted, then
`generateGroundedQuestions` asks a model to write questions from those counts. The captions —
the only place the artist's own account of their work exists — are discarded before the model
ever sees them.

That's a lossy compression that removes exactly what depth is made of. "single" cleared
`MIN_THEME_COUNT_GENERIC_WORD = 5` and became a "theme", so the model dutifully asked about it.
The machine worked as designed; the design targets frequency, and frequency is not meaning.

Pharaoh's own captions contain things like *"Someone told me to practice having an idea then
immediately executing it."* No counter can see that. A model reading the caption can.

## Why it was built this way

Not carelessness — the EVIDENCE INVARIANT. Every grounded question must cite the exact post it
came from. Structured signals make correct citation trivial, because the signal already carries
its evidence URLs.

Handing raw captions to a model reintroduces the failure Pete already hit once in testing: a
question that had nothing to do with the post it pointed at. That bug is why the citation
discipline exists, and it should not be traded away.

**Structured signals buy correct citations and cost depth.** That's the real trade, and it hasn't
been named before now.

## The resolution

Keep the citation binding structural; stop compressing the material.

Present candidate posts to the model as `id + caption + date + engagement`, and require it to
return the **post ids** it selected. It reasons over real text, but the citation is exact because
it chose an identifier rather than recalling a URL. The invariant holds without the counting
layer.

Then change what it's looking for. Not what's frequent — what's worth asking about:

- **The unexplained** — a post that implies a backstory it doesn't tell. That is precisely where
  a question earns its place.
- **What changed** — two years of posts contain a trajectory. Trajectory is story.
- **What's missing from the record we already hold** — the catalog, the About, the vault
  sources. The most interesting question is usually about the gap between what's documented and
  what isn't.
- **People and places**, not metrics.

## A side effect worth noting

This dissolves the music-credit problem rather than solving it. Today an audio credit either
becomes a `MusicReference` (trusted as the artist's own work) or is dropped at ingest — and the
two layers currently disagree about which, see `onboarding-fixes.md` 2.0. Under a
read-the-captions design, an audio credit is just one more piece of context the model weighs
against everything else it can see, including the artist's real catalog. No category to trust or
discard.

## Related

CY's bar from 8/20 — the artist should come out *feeling seen in a way they didn't realise they
could be perceived.* A question derived from word frequency does the opposite: it proves nobody
looked. This note is the mechanism behind that bar, and it's the same argument as
[where the answers go](2026-08-21-where-do-the-artists-answers-go.md) — the questions and the
answers are both currently treated as data plumbing rather than as the product.
