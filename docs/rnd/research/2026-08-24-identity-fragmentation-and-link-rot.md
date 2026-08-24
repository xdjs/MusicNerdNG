# Two problems from a call with Sherwinn "Dupes" Brice

Pete, 8/24, raw from a phone call with the artist. Both are structural, neither is an onboarding
bug, and the second one has a deadline attached that we do not control.

---

## 1. One human, many DSP artists

Searching his name returns four entities:

```
Sherwinn Dupes Brice                       ← in MusicNerd
Sherwinn Dupes Brice & Hebrue              ← Deezer, not in MN
Sherwinn Dupes Brice & Olivia Abraham      ← Deezer, not in MN
Sherwinn "Dupes" Brice                     ← Deezer, not in MN
```

Two different causes, wearing the same clothes:

**Compound entities.** DSPs did not always support multiple primary artists, so a collaboration
minted a NEW artist called `A & B`. Those releases are his, on an artist page that is not his.
Every artist working before that change has some.

**Punctuation variants.** `Sherwinn Dupes Brice` and `Sherwinn "Dupes" Brice` are one person and
two strings. Nothing about the platform reconciles them.

He is looking at four profiles and can claim one.

### The schema cannot express this

`artists` holds ONE `spotify` and ONE `deezer` per row. A human with four Deezer IDs has no
representation — the options today are four separate artist rows (fragmenting his catalog, his
sources, his knowledge document) or three of them staying unclaimed forever.

Fixing this properly means one MusicNerd artist ↔ MANY platform ids. `artist_id_mappings` already
exists but models a different axis: one artist across DIFFERENT platforms. This is many ids on the
SAME platform, for one person. Related machinery, different shape.

### Detection is easy; the confirmation is the point

Candidate signals, none of which require guessing:

- name is `X & Y` and `X` exactly matches an existing artist
- name normalises to an existing artist once quotes and punctuation are stripped
- the compound's releases overlap the base artist's

But we do NOT auto-merge on any of them. Name matching is what produced Black Dave the amplifier,
Rango the film soundtrack and Pharaoh Overlord — three separate incidents in one week. The
difference here is that **the one person who knows the answer is standing right there**, at
exactly the moment they are motivated to answer.

So: at claim time, surface the candidates with their release lists — *"these look like they might
also be you"* — and let the artist confirm or reject in one action. Claim all of them in one go.
Rejections persist, the way source rejections already do.

That also feeds the coverage question. Three of his four profiles are not in MusicNerd at all.

---

## 2. Link rot: loopnews.com is gone, and it took the Caribbean scene with it

Pete: *"There was a publication called loopnews.com that recently went offline. This used to be a
huge news/blog source for the Caribbean, where they had documented so much of the music scene.
Recently they took the website down and now you can't find so many articles Dupes used to have on
the site."*

A directory whose sources are URLs is a directory that decays at the rate its publishers go out of
business. For scenes outside the US/UK press, where documentation is thin and concentrated in a
few outlets, one publication dying can erase most of the written record of a decade.

### Where we actually stand — better than it looks

We store the article TEXT, not just the URL. On Pete Rango's four approved sources right now:

```
  3,438ch  captured 2026-08-22  lifechangesnetwork
  3,866ch  captured 2026-08-22  peterango.com
  8,696ch  captured 2026-08-22  rvamag (Big Scouse)
  9,674ch  captured 2026-08-22  voyagemia
```

If those sites vanished tonight, the knowledge document and the Ask section keep working.

**But only as of 2026-08-22.** Before that day, extraction capped at 5,000 characters and flattened
the page to one line, so everything captured earlier is a truncated blob — that is what Pharaoh's
sources still are. The archive is three days old.

### What is genuinely missing

- **No liveness check.** `fetchPageContent` runs at discovery and when a source is added, never
  again. A dead source looks exactly like a live one until someone clicks it.
- **No content hash.** Nothing proves the stored text is what the page said, which is the whole
  question once the page is gone.
- **No independent copy.** Everything rests on our database being intact and trusted.
- **No original HTML** — images, structure and formatting are already lost.

### Steps, cheapest first

1. **Never delete text when a URL dies.** A dead link with preserved text is still a source; today
   nothing distinguishes the two states, so nothing protects it. Add a liveness sweep that marks
   the URL dead and leaves the text alone.
2. **Submit approved URLs to the Wayback Machine.** Free, immediate, third-party, and already the
   citation standard for dead links. Highest value per unit of effort by a distance.
3. **Hash the text at capture.** Cheap, and it is the thing that makes a later permanence claim
   mean anything.
4. **Permanent storage** — Arweave (pay once, stored indefinitely) fits better than a general
   chain, which is expensive at bulk text.
5. **Chain anchoring** — put the HASH on-chain, not the article. That buys tamper-evident
   timestamping: proof that this text existed in this form on this date. Storage lives elsewhere.

Pete asked whether blockchain is the answer. The honest split: chains are poor at storing article
text and excellent at proving *when* something existed and that it has not changed since. So
storage in the database or Arweave, hash and timestamp on-chain. Steps 1 and 2 deliver most of the
real protection for almost nothing, and neither needs a wallet.

### The constraint nobody will raise unprompted

Preserving a publication's full article text is a copyright question. Holding it as internal
source material to ground a profile is one thing. Republishing it permanently and publicly on a
chain, where it cannot be taken down, is a different thing with no undo. If step 4 or 5 happens,
it needs a real answer on what exactly gets published versus what stays internal — quite possibly
hash and metadata public, text private.
