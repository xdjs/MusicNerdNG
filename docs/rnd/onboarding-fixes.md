# Onboarding fixes — from the 2026-08-21 artist test

Everything the Pharaoh session surfaced, in the order worth doing it. Source:
[the writeup](research/2026-08-21-artist-test-pharaoh.md).

Status: `todo` · `doing` · `done` · `parked`. Root cause noted where it's already found — those
are ready to build. The rest need investigation before they're estimable.

---

## 1 · Bugs with root cause found — ready to build

### 1.1 Instagram ingestion is never wired in `done`
The grounded-question feature has never run on data it collected itself.
`ingestInstagramPosts()` is called only by `scripts/ingest-social.ts`, a manual CLI. Pharaoh had
0 rows in `artist_social_posts`; Pete had 299, hand-seeded.

Needs a decision, not just a wire-up: **where does it trigger, and what does the artist see while
it runs?** It's an Apify round-trip on a user-facing path, and the About flow already taught us
what a wide synchronous budget costs. Options: fire on link confirmation and let the interview
step wait on it; run it ahead of the interview step; or make it background work the interview
polls for.

Also: `artist_social_profiles` has zero rows for both artists, so that table looks unwritten even
on the working path. Check while in here. *(Still open — not touched by the fix below.)*

**Done 8/21.** `ensureRecentSocialPosts()` — idempotent, and deliberately knows nothing about
onboarding steps so the trigger can move to claim approval under a pre-filled-profile flow
without a rewrite. Fired from `confirm_profiles` via Next's `after()` (first use in the repo;
a bare floating promise can be frozen by Vercel once the response flushes). Onboarding ingests
60 posts rather than the CLI's 200 — same signals, materially faster run. The interview step
waits up to 8s for a nearly-finished scrape before falling back.

**Verified end to end against Pharaoh on dev**, not just unit-tested — the wiring gap is exactly
what unit tests missed the first time. 0 posts → `ensureRecentSocialPosts` → **60 posts in 58s**
→ 3 grounded questions with real source URLs (e.g. *"You tagged the Yamumoto Remix of 'Don't Let
Me Go Alone,' featuring Jameir Thompson; how did that collaboration and remix come about?"*).
Second call returned `already_present` without re-scraping.

**The 58s number is the one to remember.** The scrape runs about as long as the entire vault step
(45s of discovery plus curation time), so the race is real but usually winnable, and the 8s wait
covers the margin. If the vault step ever gets faster, this gets tighter.

Open follow-up: see "when do the questions get asked if the flow collapses" in `decisions.md` —
moving them to the email cadence would delete this race rather than work around it.

### 1.2 The empty-posts path is silent `done`
`generateGroundedQuestions` does `if (posts.length === 0) return []` — no log, no signal. A
degraded run looks identical to a working one with nothing to ask about. This is *why* 1.1
reached a real artist.

**Done 8/21.** The three causes are now distinguishable in logs: no posts at all, posts present
but nothing cleared the bar, and the ingest outcome itself (`disabled` / `no_handle` /
`already_present` / `ingested` / `found_nothing` / `error`).

### 1.3 "Still missing: TikTok" after TikTok was added `todo`
`StepCards.tsx` builds `coveredSiteNames` from `payload.links` + `candidates` only. A link the
artist pastes locally lives in separate client state and never joins that set, so the platform
stays listed as missing directly below the line confirming it was added. Seen in the session.

### 1.4 "Look for more" discards confirmations and re-offers the same profiles `todo`
Card confirmations are client-side until "Looks good, continue" persists them.
`find_more_profiles` calls `emitStep(..., true)`, which re-renders from server state — where only
Deezer was saved. His four confirmed profiles were thrown away and came back as fresh candidates.

The reset is deliberate (a re-search must not silently save something the artist rejected) but it
discards accepted ones too. Fix: round-trip or persist the current card state on "Look for more",
keeping the opt-in/opt-out semantics intact.

---

## 2 · Bugs still needing investigation

### 2.0 Hallucinated *authorship* in interview questions `done`
Found 8/21 while verifying 1.1. Pharaoh was asked *"You tagged the Yamumoto Remix of 'Don't Let
Me Go Alone,' featuring Jameir Thompson; how did that collaboration and remix come about?"* — a
track he had no part in.

Not a model hallucination. `extractMusic` already had a guard for "the audio is credited to the
poster, so it isn't a real third-party credit" — it just never fired. It compared Instagram's
`artist_name` (a **display name**, "Pharaoh Sistare") against the **handle** (`pharaohsistare`)
using a normaliser that preserves spaces. Those can never match, so 11 posts across 5 titles kept
a bogus credit and the generator faithfully asked about the collaboration they implied.

The first fix compared loosely against the handle — which only worked because Pharaoh's handle is
his name minus the space. Pete caught it: **a handle is not a name.** "Black Dave" posts as
@worstgeneration, "Pete Rango" as @p3t3rango. The guard now compares against `artists.name`,
resolved once per ingest so the CLI path gets the same protection.

Verified by re-mapping Pharaoh's 60 stored raw items through the fixed path — no new scrape:
self-credits 11 → **0**, and the four remaining credits are all genuinely third-party (Chic,
Depeche Mode, Tommy Richman, Cherrelle). The collaboration question is gone.

**Why it survived:** the existing unit test used `artist_name: 'P3T3RANGO'` — a handle in caps.
It passed because `norm` lowercases. The test encoded the same wrong assumption as the code.

### 2.1 + 2.2 Hallucinated sources `done`
They were one bug. Investigated 8/21 with Pharaoh's real data.

**The URLs are written by the model, not retrieved by search.**

`vaultWebSearch` enables `tools: [{ googleSearch: {} }]` and then, in the same call, asks the
model to *"Return ONLY a JSON array"* of results. Grounding loads real search results into
context, but emitting JSON is **generation**, not retrieval. Gemini returns what was actually
retrieved in `groundingMetadata.groundingChunks` — **that field is never read anywhere in this
codebase.** The code parses the model's prose instead, so nothing binds an emitted URL to
anything search returned.

The prompt does try: *"must be a real, working URL you found via web search"*. That's an
instruction, not a constraint. You can't instruct a model out of generating.

**Evidence.** Pharaoh's entire discovery yield was two sources, both fabricated:
- `youtube.com/watch?v=F_f7k9Q8sA4` — "Pop Music RVA: Pharaoh Sistare". oEmbed returns **404**;
  the video does not exist. Title and snippet invented.
- `music.youtube.com/channel/UC-K-sO8x5N2g-K_f9_p8Q5Q` — page carries a "not available" marker
  and the word "Pharaoh" appears **zero** times.

Both were deleted 8/21 (backed up first). So 2.2 isn't a separate bug: discovery didn't *miss*
his press, it retrieved nothing and invented two items.

**Why verification didn't catch it.** `classifyFetchedSource` is sound but YouTube defeats it:
YouTube returns **HTTP 200 for a nonexistent video** (776KB of JS shell), and its pages are
JS-rendered so `extractedText` never reaches `MIN_VERIFIED_TEXT` (400). The ladder therefore
returns `"lead"` — never `"dead"` — and the `DEAD_PAGE_MARKERS` check sits *below* the 400-char
gate, so it's unreachable for JS-rendered pages. Real and fabricated YouTube URLs classify
identically.

**Contained, but not harmless.** `extracted_text` is NULL on leads, so `isCitableSource` excludes
them and the About won't quote them — the About guardrails held. But the artist is shown a
confident-sounding source and approved it, so fabricated press sat on his profile.

**Tavily coverage probe, 8/21 — run before committing to a rewrite.** Tavily is already in the
repo but wired to ONE caller: `profileDiscovery.ts` tier 4. `vaultWebSearch` (press, interviews,
articles — called from claim approval, the vault step, the "Search web" button, and About
generation) still uses the Gemini pattern. The lesson was learned for profiles and never applied
to sources. `webSearch.ts`'s own docblock argues the case: *"a model deciding whether to search
is not a substitute for an actual search API."*

Results, 3 queries per artist, URLs HTTP-checked:

- **Pharaoh Sistare** — 11 real URLs, 7/8 sampled returned 200. Including
  **"PHARAOH SISTARE on Shockoe Sessions Live!"** (`youtube.com/watch?v=GvqK4m2i9Mc`) — the
  Richmond session Pete asked him about, and the exact thing discovery "missed". Gemini invented
  *"Pop Music RVA: Pharaoh Sistare"* instead of returning it. Also surfaced his correct Spotify
  ID, Chartmetric, Instagram, TikTok. **So 2.2 was never a coverage problem — the content was
  always findable.**
- **Black Dave** — 10 real, resolving URLs, and **none about the right artist.** All Dave the UK
  rapper, his song "Black", or Dave Black the composer.
- **Grimes** — good coverage, with a "Luke Grimes" country review leaking in.

**Conclusion: the two failures are separate and Tavily only fixes one.**

| | Gemini today | Tavily |
|---|---|---|
| links that don't work | invents them | fixed — URLs come from an index |
| links that aren't related | invents *and* conflates | **not fixed** — real URLs, wrong person |

Relatedness needs the identity anchoring already built for the About (verified platform ID,
`nameAppearsIn` on fetched content). That machinery exists and simply isn't applied on this path.
Tavily returns the artist's correct Spotify ID, so anchoring has something real to bind against.

**Fixed 8/21.** Retrieval moved to Tavily via `webSearch()`; Gemini is out of this path
entirely and back to synthesis only. Type comes from `inferTypeFromUrl` rather than a model —
the URL is a better signal and can't be invented. Queries quote the artist name, because an
unquoted multi-word name matches each token independently, which is how "Black Dave" returns
Dave the UK rapper.

**The swap alone would have been a regression**, which the coverage probe caught in time.
`nameAppearsIn` falls back to the most *distinctive token* when the full name is absent — for
"Black Dave" that's `black`, which matches a large share of the web. A real Guardian interview
with Dave the UK rapper would have classified as `verified`, gained `extractedText`, become
citable, and been quoted in Black Dave's About. Today's fabricated YouTube links avoid that only
by being unreadable. **A plausible wrong-artist source is worse than an obvious fake.**

So `classifyFetchedSource` now takes `requireFullName`, set on this path only: a search-retrieved
page must name the artist in full to be citable. Anything that half-matches degrades to an
unverified lead the artist still sees and judges. The artist's own site and links they hand us
keep the looser rule, which exists because Pete's homepage renders "RANGO" as a wordmark.

**Verified live against Pharaoh** (dev): **12 real sources, 0 dead URLs, 8s** — against 2
sources, both fabricated, before. Includes "PHARAOH SISTARE on Shockoe Sessions Live!", the
Richmond session discovery was said to have missed. Every namesake (Pharaoh Overlord, Pharaoh Jo,
a metal band called Pharaoh) landed as a non-citable lead.

**Two limits, honestly:**
- **Only 2 of 12 are citable**, and both are aggregators (Viberate, Apple Music). The best source
  — the Shockoe Sessions video — is a lead because YouTube is JS-rendered and unreadable, so it
  can't feed the About. Rich editorial material is still thin.
- **Namesake leads are still displayed**, just not citable. A readable page that never says the
  artist's full name could arguably be dropped outright rather than shown; not done, because the
  looser rule exists for a real reason and dropping is irreversible. Open question below.

**Superseded fix options** (kept for the record): reading `groundingMetadata.groundingChunks`, or
adding YouTube oEmbed to the classifier. The first is moot now Gemini is off this path. The
second is still worth doing for the JS-rendered blind spot — see 2.5.

### 2.5 The verifier can't see JS-rendered pages `todo`
YouTube returns HTTP 200 for a nonexistent video, and its pages carry no readable text, so
`extractedText` never reaches `MIN_VERIFIED_TEXT` (400) and the ladder returns `lead` — never
`dead`. `DEAD_PAGE_MARKERS` sits *below* that gate and is unreachable for such pages. Real and
fake YouTube URLs are indistinguishable to the verifier.

Less urgent now retrieval can't fabricate, but it's why the Shockoe Sessions video can't be
cited. YouTube's oEmbed endpoint is keyless and correctly 404s a fake — worth using both to
verify existence and to lift real videos out of lead status.

**Old fix options, for reference:**
1. **Read `groundingMetadata.groundingChunks`** and discard any emitted URL not in the retrieved
   set. The minimal correct binding; no architecture change.
2. **Use Tavily** (`webSearch.ts`, already in the repo and wired for profile discovery) — a real
   retrieval API whose URLs come from an index, so it structurally cannot invent one.
3. **YouTube oEmbed** in `classifyFetchedSource` — keyless, correctly 404s a fake and 200s a real
   video. Fixes the verification blind spot but not the generation of bad URLs.

Note: the previously-planned **grounded-prose → ungrounded-structuring split** improves JSON
reliability but does **not** fix this on its own — a structuring pass can still alter a URL.
Binding to retrieval (1) or retrieving directly (2) is what actually closes it.

---

### 2.3 The questions are shallow by construction `todo`
Pete, 8/21, on *"You often use the word 'single' in your captions..."*: **"so shallow and has no
depth. we should be finding out more about the artist."**

Not a wording problem. `deriveSocialSignals` compresses every post to countable things — word
counts, hashtag counts, engagement outliers, audio credits — and the captions are discarded
before the model sees them. Frequency isn't meaning, so questions derived from frequency can't
have depth. "single" cleared `MIN_THEME_COUNT_GENERIC_WORD = 5` and became a "theme".

The counting layer exists for a good reason: the EVIDENCE INVARIANT. Structured signals make
correct citation trivial, and handing raw captions to a model reintroduces the "question has
nothing to do with the post" bug Pete hit in earlier testing.

Resolvable: give the model `id + caption + date + engagement` and require it to return the post
**ids** it chose. Real material, exact citation, no counting layer. Then look for the
unexplained, what changed over time, and what's missing from the record we already hold — not
what's frequent. Full argument in
[notes](notes/claude/2026-08-21-shallow-questions-are-structural.md).

Supersedes the narrower question of whether to trust audio credits (2.0) — under this design a
credit is context the model weighs, not a category to trust or drop.

### 2.4 Generic words clear the theme bar `todo`
`MIN_THEME_COUNT_GENERIC_WORD = 5` lets music-domain filler ("single", "song", "music", "next",
"first", "time", "year") become themes. **Logged, not fixed** — Pete's call on 8/21: one artist
isn't enough to tune a threshold on, and hand-tuning against Pharaoh's captions would overfit to
him. Revisit with more artist tests. Likely moot if 2.3 lands.

---

## 3 · Copy and structure

### 3.1 Separate press/research links from social and streaming `todo`
Pete, 8/21. Press, interviews, and features shouldn't be gathered in the same step as social and
streaming profiles — they're a different kind of thing and the current mixing is what produced
3.2. Give research links their own section rather than folding them into "profiles".

### 3.2 The "add more" ask doesn't say what to add `todo`
> It just asked for profiles that are mine. And then it said "add more," but it didn't specify
> adding things like publications.

He read "profiles" literally as social profiles, so he never added the article about him. Name
the categories: publications, interviews, features, your own site. Cheapest high-value fix on
this list, and it feeds 2.2 — the discovery gap partly self-corrects if artists know what to
hand us.

### 3.3 Say what the flow is doing, while it does it `todo`
> It was a little confusing. I wasn't entirely sure what it was doing.

Broader than one string. The flow doesn't explain what it's looking for or why at the moment it
asks.

---

## 4 · Product direction — decide before building

### 4.1 Guided review of a generated profile (Carl's flow) `todo`
Endorsed by Pharaoh with a reason — he'd noticed he was hand-typing what the system should have
known. The payoff isn't fewer steps, it's arriving at something already correct. Note nobody
complained the flow was long, so "make it shorter" is the wrong success measure.

Still open from 8/20: wizard vs. per-section affordances.

### 4.2 Editorialise or transcribe? `todo`
> I wish it could take what I provided and make an editorial version of it, versus just repeating
> exactly what I gave it.

Direct tension with the About's "mine, don't summarize" mandate and factual voice — both added to
stop hallucination and relationship-inflation. He wants shaping; shaping is how the Black Dave
conflation happened. Needs a deliberate line, not a default.

### 4.3 Weekly follow-up emails `todo`
Endorsed, but described rather than experienced. Build a real one and send it to him rather than
asking again.

### 4.4 Spotify bio is not available `parked`
He assumed it was the natural source and retyped it from memory. Spotify's API doesn't expose
artist bios. No action unless someone finds a route.

---

## Suggested order

1. **3.2** — an hour of copy, and it partly fixes 2.2.
2. **1.3 + 1.4** — both visible in one screenshot, both client-state bugs, both make the flow feel
   broken in front of an artist.
3. **1.1 + 1.2** — the highest-value feature in the demo, currently doing nothing.
4. **2.1 + 2.2** — investigate together.
5. **3.1** — structural, and it should land before 4.1 rebuilds the flow around it.
6. **4.x** — take to Carl and CY on Thursday first.
