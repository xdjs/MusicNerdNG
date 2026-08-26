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

### 1.3 "Still missing: TikTok" after TikTok was added `done`
`StepCards.tsx` builds `coveredSiteNames` from `payload.links` + `candidates` only. A link the
artist pastes locally lives in separate client state and never joins that set, so the platform
stays listed as missing directly below the line confirming it was added. Seen in the session.

**Done 8/21.** Pasted links now count toward the covered set, matched by host segment (so "x"
can't match every hostname containing the letter).

### 1.4 "Look for more" discards confirmations and re-offers the same profiles `done`
Card confirmations are client-side until "Looks good, continue" persists them.
`find_more_profiles` calls `emitStep(..., true)`, which re-renders from server state — where only
Deezer was saved. His four confirmed profiles were thrown away and came back as fresh candidates.

The reset is deliberate (a re-search must not silently save something the artist rejected) but it
discards accepted ones too.

**Done 8/21.** `find_more_profiles` now carries the same payload as `confirm_profiles` and saves
it before re-searching, so the re-emitted card reflects the artist's decisions because it reads
from the database rather than client state that no longer exists. The link-application logic was
extracted to `applyProfileLinkDecisions`, shared by both handlers — only `confirm_profiles`
advances the step. The card builds its payload in one place so the two buttons cannot drift.

Consistent with what the card already promises the artist: *"Leaving a card as-is confirms it."*
Re-searching now honours that too.

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

### 2.8 The artist's judgment is discarded in BOTH directions `done (URL level)`
Pete, 8/21: *"the artist should be able to flag when something is not them and that should help
optimize the build of their profile and make it more accurate."* Correct, and it's worse than it
looks — the discard is deliberate:

```js
// Only dedup against pending + approved sources (allow re-discovery of deleted/rejected URLs)
```

| Artist says | What happens today |
|---|---|
| "yes, that's mine" | still not citable — never reaches their About (2.6) |
| "no, that isn't me" | may be re-surfaced by the next discovery run |

So Black Dave can reject the Chord DAVE amplifier reviews and Dave the UK rapper's Guardian
interview, and get both back next week. **The artist is the highest-quality signal we have about
who they are, and we throw away both answers.** Every accuracy problem in this thread — namesakes,
the wrong Black Dave, fabricated sources — is the system guessing at something the artist could
tell us once.

**Prior art exists in this repo:** `artist_mapping_exclusions` (schema.ts:514) does exactly this
for ID mapping — unique on `(artist_id, platform)`, typed `exclusion_reason`, soft-deletable.
Built for one domain, never applied to sources.

**A rejection can teach more than "hide this row":**
- **URL** — never re-surface it. Trivial, immediate, fixes the re-discovery bug outright.
- **Domain** — two rejected `head-fi.org` threads means stop trusting that host *for this artist*.
- **Entity** — three rejected "Pharaoh Overlord" results means that name variant isn't him;
  filter it from future queries.

The entity level is what makes discovery improve per-artist over time instead of repeating the
same mistakes at the same confidence forever.

**Done 8/21 — URL level.** Discovery now dedups against `rejected` as well as pending and
approved. Deleted rows are unaffected: a deleted row is gone from the table, so it appears in
none of the three sets and stays re-discoverable, which was the original reason rejections were
excluded. Rejected URLs are dropped *before* the verification pass, so a rejection also saves the
fetch it would have cost. Logs now distinguish "we already had this" from "the artist said no".

**Verified live.** Rejected three real namesakes for Black Dave (Dave the UK rapper in the
Guardian, two Chord DAVE audio-DAC pages) and re-ran discovery:
`Skipped 2 duplicate(s), 2 previously rejected by the artist`. Tavily offered them again;
discovery dropped them.

**And the same run proved the URL level is not enough.** Two *different* Chord DAVE reviews came
back — soundnews.net and the-ear.net. He rejected two, the web has dozens. Blocking one URL at a
time cannot keep up with an entity that has unlimited coverage. **Entity-level rejection is now
demonstrated as necessary rather than speculated:** three rejections all matching "Chord DAVE"
should teach us that entity isn't him, and filter it from future queries.

Pairs with 2.6 — see the position taken there.

### 2.6 Artist approval doesn't make a source citable `todo`
`isCitableSource` reads `extractedText` only — status is irrelevant — and
`artistDocService` does `approvedSources.filter(isCitableSource)`. So an artist can look at a
source, recognise it as their own work, approve it, and it still never reaches their About. We
ask them to curate and then discard the answer. Nothing tells them.

Widened by `requireFullName` (2.1): more real sources now land as leads, so more approvals get
discarded.

**Position taken 8/21: do not honour approval — it is not a signal.**

The vault card is keep-by-default: `status: skipped.has(s.id) ? "rejected" : "approved"`. Every
source the artist does not touch becomes "approved". Treating that as authorisation to cite means
treating *"didn't read it"* as *"I verified this"* — which is exactly how the Thrasher article
would reach Black Dave's About while he thinks he is just moving on.

Rejection is the opposite: it requires a deliberate click. That asymmetry is why 2.8 is safe to
build and why 2.6 is not its mirror image.

So the fix is to change **what counts as affirmation**, not the citability bar — the bar is doing
its job, and is why no namesake has become citable in any run. Split by actual cause:

- **A: the page is unreadable** (Cloudflare, JS-rendered). There is no text, so honouring approval
  would not help — there would still be nothing to cite. **Fix with content, not trust:** the
  YouTube transcript path (4.3) turns these into citable sources carrying real verbatim material.
- **B: readable, but the name is absent.** We have the text and chose not to trust it. Real cases
  exist — Black Dave's press is written under "Black Dave", not "Black Dave MK2". **Fix with a
  deliberate act:** an explicit "this is me" on a *specific* source, distinct from the default
  keep. Only that promotes to citable.

### 2.7 Black Dave verification, 8/21 — what the namesake gate actually did
Run against `Black Dave MK2` (dev `011645a7`), the hardest case we have: three Black Daves in the
database, plus Dave the UK rapper, plus a **Chord DAVE** audio DAC.

- **11 sources, 0 dead URLs, 6s. No namesake became citable.**
- The one that did become citable is **correct** — Sound of Fractures' *"An interview with
  Multi-hyphenate Black Dave Mk2"*, verified by reading it: "mk2" three times, "the intersection
  of anime, rap music, streetwear and sneaker culture", no skate/NYC content.
- Chord DAVE DAC reviews, the Guardian on Dave the UK rapper, and a Thrasher "Black Dave
  interview" all landed as non-citable leads.

**Names are messier than expected.** Spotify's own name for `7cOl6pCLdiRKfC8nnNQ0ax` really is
"Black Dave MK2" — that suffix is his, not our bookkeeping. But `Black Dave NYC` in our database
is "Black Dave" on Spotify, so *that* suffix is ours and does leak into queries. Worth using the
verified platform name where we have one.

**And press is written under the older name.** Coverage of him as plain "Black Dave" can't clear
`requireFullName` against "Black Dave MK2". That is the cost of the gate, paid knowingly: a
missed real source is recoverable, a cited namesake is not.

*Correction for the record: this note first described the Thrasher interview as genuinely his.
That was an assumption from "skate magazine sounds plausible for a rapper", not a check. Pete
challenged it. The page is Cloudflare-blocked so nobody can read it, there is a known NYC
skater-rapper Black Dave, and MEMORY.md records the earlier About bug pulling "the wrong Black
Dave's skate pages". Treat it as the wrong artist.*

### 2.9 requireFullName demoted the artist's own website — fixed same day
Found by running **Pete Rango** through discovery as a third test artist, which is the whole
argument for testing more than one.

`requireFullName` (2.1) is right for a page a keyword search returned and wrong for the artist's
own site. Measured on the real peterango.com: `nameAppearsIn` loose = true → `verified`, strict =
false → `lead`. The page renders the two words apart, so the full phrase never appears in the
extracted body — **exactly the case `nameAppearsIn`'s own docblock was written about**, re-broken
by my change.

Fixed by exempting the artist's own domain: a hostname that IS the artist's name is stronger
evidence of ownership than any phrase in the body. It cannot reopen the namesake hole — "Black
Dave MK2" matches none of theguardian.com, head-fi.org or soundnews.net, and a test pins that.

Live result: peterango.com went lead → **CITABLE**, and his citable count went 2 → 3 while
dead and citable-off-topic stayed at 0 for all three artists.

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

### 1.5 Discovered profiles were never saved — the card contradicted itself `done`
**The worst bug found so far.** Pete completed all four onboarding steps on 8/21 and ended with
only the Deezer link he started with. Spotify, Instagram, X, YouTube, SoundCloud, Bandcamp,
Facebook — all discovered, all shown, none saved. He assumed he'd forgotten to approve them.

He hadn't. Discovered profiles were **opt-in** (`nothing here is submitted unless explicitly
accepted`) while the card's own first line read **"Leaving a card as-is confirms it — remove
anything that isn't you."** That sentence describes opt-*out*. Half the card behaved the opposite
way to its own instruction, and the artist did exactly what he was told.

**This was already decided on 8/20 and never implemented** — see `decisions.md`: *"Pre-select
confident single matches. Where several candidates exist for one platform, don't surface them to
be unchecked."* Neither half was in effect.

Now implemented as agreed:
- A platform with **exactly one** candidate is pre-accepted, like a confirmed link. Continuing
  saves it. (Carl's reasoning: the goal is getting the profile created, so the quickest path
  wins.)
- A platform with **several** candidates is dropped from the card entirely and surfaces in "Still
  missing", so the artist pastes the right one. (CY's reasoning: unchecking your own old profiles
  feels worse than adding the correct one.) This also avoids two real defects — `accepted` is
  keyed by siteName, so accepting one of two same-platform candidates would have saved both, and
  they collide as React keys.
- The narration says they're added rather than asking the artist to confirm them.

Four existing tests encoded the old opt-in rule and were rewritten rather than deleted — the
safety property moved from "never auto-save a guess" to "never auto-save an *ambiguous* guess",
which is what the meeting actually decided.

### 2.10 Questions about years-old posts — `postedAt` was never used `done`
Raised by Pete in the 8/20 meeting (*"now it's referencing a post I did in 2020… how is it
relevant now?"*), not fixed, and hit again on 8/21 when his own run asked him to reflect on 2020.

`postedAt` was stored from the very first ingest and **used by nothing** — no sort, no window, no
weighting anywhere in `socialSignals.ts`. A 2020 post competed on exactly equal footing with last
week's.

Signals now derive from a recency window (548 days — generous, because an album cycle is long and
last year's release is still live for an independent artist). If recent activity is thinner than
30 posts, it falls back to the artist's **whole history** rather than an arbitrary slice: the
window exists to stop old posts crowding out new ones, not to discard data from someone who posts
rarely. Engagement medians are computed over the same subset on purpose — a standout should stand
out against what the artist does now, not a five-year average.

**Verified on Pete's real 299 posts** (2018–2026): the window selects **47** (2026: 44, 2025: 3),
and the questions changed from *"your post reflecting on 2020"* to his Colombia earthquake relief
page and a recent @dameatlas collaboration — the kind he singled out as good in the demo.

### 2.11 Discovery re-offered profiles we already have as links `done`
Pete, 8/21: his own Spotify and X pages were surfaced among 13 "sources about you". They aren't
research — they're identity we already hold, and re-presenting them costs a decision for nothing.

Discovery deduped only against vault sources, never against the artist's platform links. Now a
candidate whose URL contains a stored platform value is skipped. Matched on the VALUE, not the
host — host matching would discard every youtube.com result for any artist with a YouTube link,
including the Shockoe Sessions interview that was the best source found for Pharaoh.

*Note from the same run: those three profile URLs were already `approved` in his vault — almost
certainly by default rather than by decision, since the vault card is keep-by-default. That is
the clearest evidence yet for the position taken in 2.6.*

### 2.12 Stale facts stated in the present tense `code done, migration pending`
Pete, 8/21, on his own About: *"it's not good to assume that Parris Pierce is my production
partner — that interview was years ago and we don't work together anymore."*

Same class as the relationship-inflation in `MEMORY.md`, but across TIME rather than across
people. The prompt has an ANTI-INFLATION rule, and it only preserves time-scoping the document
already carries — **the document carries none, because we never record when a source was
published.** `artist_vault_sources` stores `created_at` (when *we* found it), not the article's
date. Every source therefore reads as equally current, and a 2019 collaboration becomes "his
production partner".

Fix: capture a publication date during verification — `article:published_time`, `og:updated_time`,
JSON-LD `datePublished` are all in the HTML we already fetch — carry it into the doc's source
manifest, and require claims to be scoped by it. Anything not evidenced as current is past tense.

**Built.** `extractPublishedDate` reads those, with `<time datetime>` last (it marks any date on a
page, including a comment's). Measured on his four real sources:

| source | published |
|---|---|
| voyagemia | **2019-01-10** — the Parris Pierce interview, seven and a half years old |
| lifechangesnetwork | 2024-01-24 |
| soundbetter | none (a directory has no publication date) |
| rvamag | none |

Conservative by design: unparseable, pre-1995 or future dates return null, because a *wrong* date
would let the document confidently scope a claim to the wrong era. Undated sources are labelled
"date unknown" rather than left unmarked — "we know this is old" and "we do not know how old this
is" need different hedging, and conflating them is how a guess becomes a fact.

The doc prompt gained a TIME section: old claims take the past tense or a year; the present tense
is reserved for recent sources and things that do not decay (birthplace, releases, what a record
sounds like) rather than things that do (roles, partnerships, locations, "currently"); and two
sources disagreeing is usually one being older, not a contradiction.

**Not yet verified end to end.** The `published_at` column needs a privileged connection — the app
role `mnweb` cannot run DDL, and `SUPABASE_DB_CONNECTION` is that role, so `npm run db:migrate`
cannot apply it either. Migration `0015` is written and registered; dev needs it applied by hand
before the effect on his About can be measured.

*Found alongside: migration `0014` was hand-written and applied straight to dev but never added to
`drizzle/meta/_journal.json`, so `db:migrate` would have skipped it and the unique index behind
vault dedup would never have reached production. Both are registered now. Prod needs 0011-0015.*

> **Before the next `npm run db:generate`:** 0014 and 0015 have journal entries but no
> `drizzle/meta/00{14,15}_snapshot.json`. drizzle-kit diffs against the newest snapshot it has,
> which is 0013 — so it will re-propose the unique index and the `published_at` column, and its
> generated SQL has no `IF NOT EXISTS`, so applying it would fail against a database that already
> has them. Either write the two snapshots or hand-edit whatever `generate` produces.

### 2.13 Relevance is a substring check where it should be judgment `done (readable pages)`
Pete, 8/21: *"a lot of links in the vault that don't relate to me… in the age of AI and tech there
would be a better, smarter way to figure out what's what."* Correct.

Relevance is decided by `requireFullName` — does the fetched page contain the literal string
"Pete Rango". That is a substring test standing in for "is this page about this person", and it
structurally cannot tell a Chord DAVE amplifier review from Black Dave, or a Peter Calandra
interview from Pete Rango.

Meanwhile a **verified identity anchor sits unused**: the artist's platform ID, their real
catalog from Spotify, their confirmed handles. A model reading the fetched page against that
anchor can answer the question the substring check is pretending to answer.

This is the division already argued for and only half-built — **retrieval is a search API,
judgment should be the model.** Retrieval was fixed on 8/21; judgment is still a string match.

**Done 8/21.** `sourceRelevance.judgeSourceRelevance` reads each fetched page against a verified
anchor — the artist's real Spotify catalog and confirmed accounts, not just their name — in one
batched call. A page judged to be about someone else is **dropped**, not parked as a lead: we read
it and it isn't them, and leads exist for pages we could not read. A page it affirms becomes
citable even without a full-name match (`identityConfirmed`), which is what kept genuine press
written under an artist's earlier name from ever being usable.

Verdicts bind by **index, never by an echoed URL** — a model asked to repeat identifiers invents
them, which is exactly how this pipeline once stored a YouTube video that does not exist. Failure
of any kind leaves every candidate `undecided` and the name check decides, unchanged: a judge that
deletes real press on a bad Gemini day is worse than no judge.

**Measured live.** Black Dave: 11 sources / 8 off-topic → **4 / 1**, with the Thrasher skater
interview, a "David Black of Seduce" interview and both Chord DAVE amplifier threads dropped
outright. Pete: Wikipedia's "Pete" and Pete Buttigieg's Instagram dropped.

**Remaining gap — unreadable pages bypass the judge.** Bot-blocked (403), oddly-statused, and
JS-rendered pages have no text to reason about, so the judge abstains and they survive as
non-citable leads: Pete Buttigieg on Ballotpedia, Merriam-Webster's *definition of "pete"*, a
Chord DAVE review on the-ear.net. They cannot reach an About, but they are precisely the vault
clutter artists complain about.

Judging those on URL + title would catch all three. The counter-case is real and worth stating:
`readdork.com/artists/black-dave-mk2` is Black Dave's own artist profile and also 403s — a
URL/title judge keeps it, but a careless one could drop a real source we simply could not read,
and a wrong drop is unrecoverable. Not built; decide deliberately.

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

### 2.14 We were reading a fifth of each source, and the wrong fifth `done`

Pete, 8/21: *"if we're supposed to be a research nerd, why are we only taking part of the
material? isn't part of what we're doing scraping these sources to add to the knowledge doc?"*

Three truncations stacked on top of each other. The first was permanent.

**Scrape time.** `fetchPageContent` kept 5,000 characters and dropped the rest before anything
reached the database, so it was never recoverable. That is 54% of his VoyageMIA interview. Raised
to 50,000 — this is the archive, not a context limit, and we never re-fetch a stored source.

**A dead selection path.** The extractor ended in `\s+ -> " "`, collapsing every page to a single
line. `selectSourceText` — which keeps the paragraphs that name the artist — splits on blank
lines, so it saw one paragraph, bailed, and head-sliced. **It had never once run against a real
scrape.** Its unit tests passed because the fixtures still had newlines in them. A test can only
prove the thing it is fed resembles production.

**No boilerplate stripping.** Only `<script>` and `<style>` were removed. So a stored "source"
about an artist could be a cookie-consent policy listing Google Analytics cookie durations
(lifechangesnetwork, everything past character 4,700), or a comment form and a list of articles
about other people (voyagemia). `extractReadableText` now drops nav/footer/aside/form, keeps block
structure, and decodes entities instead of storing `people&#8217;s souls` for the model to read.

**The document was then compressing all of it to 512 words** against a consumer cap of 8,000
characters, on an instruction written when a source was a 5,000-character stub. The first thing
that compression discarded was the artist talking. Added `## In Their Own Words` and a length
target matched to the cap: his doc is now 847 words and carries six verbatim quotes — on work/life
balance, on when to release a song, on who to collaborate with and why — every one of which sat
past character 5,000 and had never entered the database at all.

**What it does not fix.** Regex cannot lift a rival's listing out of a marketplace page; those
render in the same generic divs as the artist's own. Checked empirically after the change: no
rival credits reached his document, so the density-gated selection that was ready to go was not
added on spec. If it shows up in a later artist, that is the fix.

### 2.15 Two of his four approved sources are index pages, not coverage `done`

Found while measuring the above. Mention density per source, after clean extraction:

| source | paragraphs naming him | what it actually is |
|---|---|---|
| lifechangesnetwork | 8 / 58 (13.8%) | real interview |
| voyagemia | 6 / 67 (9.0%) | real interview |
| rvamag | 1 / 15 (6.7%) | **tag archive page** |
| soundbetter | 2 / 173 (1.2%) | **marketplace directory** |

SoundBetter's own title says it: *"Mixing & Mastering Engineers, Producers & Songwriters who
worked with Pete Rango"*. It is a list of **other** producers, indexed under his name, plus a
genre filter dropdown. `judgeSourceRelevance` saw that exact title and passed it — correctly,
given the only categories it was offered were about / not-about / passing-mention. There is no
category for *"this page merely lists them."*

That is the concrete start of **2.8** at the entity level. When it happens, hand the judge the
title and "mentions the artist in N of M paragraphs" as **evidence** and let it decide — not as a
regex rule. Density alone does not separate these cleanly (6.7% vs 9.0% is too close to threshold
on) and `Archives` / `who worked with` are site-specific strings. Retrieval retrieves, the model
judges; this is that line applied one level up.

**Shipped.** `judgeSourceRelevance` gained a third verdict, `lists-artist`, and each page's mention
density is handed to it as evidence. Verified against all four of his real sources, twice: both
interviews `about-artist`, both index pages `lists-artist`, stable across runs. Deliberately not a
threshold — once handles are counted, VoyageMIA (9.0%) scores *lower* than the rvamag tag archive
(6.7%), so thresholding would have inverted exactly that pair. Retrieval retrieves, the model
judges.

**And the half he could see.** The knowledge document was written once at publish and never again,
while the sources under it stayed editable — so removing a bad source left the document citing it
forever, and the Ask section kept answering from it. There is no view or edit surface for the
document anywhere in the product, which is why nothing surfaced this. `refreshArtistDoc` now runs
on approve, reject and delete, debounced so a burst of removals costs one rebuild. It never touches
`artists.bio`: the About is the artist's and may be hand-edited.

**Still open: the document has no UI at all.** Pete, 8/22: *"how does one access the knowledge doc
to edit after page is done generating?"* You cannot. It is the thing that answers fan questions and
it is invisible and uneditable. Worth its own decision — read-only view, or editable.

### 2.16 TikTok cannot be probed at all `done (as far as it goes)`

Pete, 8/21: *"how is tiktok not findable through search if every other social media is?"*

Measured against two real handles, `@p3t3rango` and `@peterango`: both return `title=null
img=none`, while an Instagram control on the same run returns a real title and image. TikTok
serves a server-side fetch nothing. Moved into `PROBE_UNVERIFIABLE_PLATFORMS` and covered by a
test.

The consequence has to be stated honestly in the product: **we cannot tell whether he has a
TikTok.** A miss is not evidence of absence, and the flow must not imply it is. Any real fix needs
a route that renders JavaScript.

## 3 · Copy and structure

### 3.1 Separate press/research links from social and streaming `todo`
Pete, 8/21. Press, interviews, and features shouldn't be gathered in the same step as social and
streaming profiles — they're a different kind of thing and the current mixing is what produced
3.2. Give research links their own section rather than folding them into "profiles".

### 3.2 The "add more" ask doesn't say what to add `done`
> It just asked for profiles that are mine. And then it said "add more," but it didn't specify
> adding things like publications.

He read "profiles" literally as social profiles, so he never added the article about him. **Done 8/21.** The vault step's EMPTY copy already named the categories; the non-empty one did
not — it said "We found N sources about you. Keep what's accurate", which invites curation and
nothing else. He had sources found, so that is the variant he got. `vault(count)` now asks for
additions by name, the profiles ask is scoped to profiles and says press comes next, and the two
placeholders match. Also removed the last user-facing "AI" from the narration (CY, 8/20) — none
remains anywhere in the flow.

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

**Pete, 8/21: YouTube transcripts belong here, not in the About.** Verified working — Gemini
accepts a YouTube URL directly as video input and returns verbatim quotes with timestamps. On
Pharaoh's real Shockoe Sessions session: *"Thank you all for being here and thank you for having
me at Shockoe Sessions in your ear"* (0:12:34), *"This first song I'm going to sing is called
Strolight."* 79s at low media resolution, 152s at `fps: 0.2`.

That is the richest question material available anywhere in this system — the artist talking about
their own work, unprompted. "You said this at Shockoe Sessions, tell me more" is a different order
of question from "you use the word 'single' a lot" (see 2.3). And the email format dissolves the
latency problem: nothing is waiting on an 80s transcription.

Costs: token-heavy (a full-length video blew the 1M limit before sampling was capped), needs
selection so music videos don't burn budget, and it transposed his name to "Pharoah" from
on-screen branding — fine as source material, not to be copied verbatim into a profile.

*Separately, the same API call is a free verification signal: a fabricated video ID returns
NO_ACCESS in ~1s. See 2.5.*

### 4.4 Spotify bio is not available `parked`
He assumed it was the natural source and retyped it from memory. Spotify's API doesn't expose
artist bios. No action unless someone finds a route.

### 4.5 Does the Instagram scrape belong in onboarding? `for the team — 8/27`

**Left ON for now.** Pete, 8/22: *"let's keep it for now."* This is a question to put to Carl and
CY rather than settle unilaterally, because it trades cash against a feature none of us has seen
working at scale yet.

**What it costs.** Measured from the Apify API, not the rate card. `apify/instagram-scraper` bills
$2.70/1,000 results and onboarding pulls 60 posts, so **$0.162 per claimed artist**, once — the
`hasSocialPosts` guard means it never re-runs. Lifetime spend to date is $1.11 across 4 runs.

| | |
|---|---|
| artists in the database | 41,984 |
| …with an Instagram handle | 29,059 |
| **approved claims (the only artists who onboard)** | **5** |
| 100 claims/month | $16/month |
| 1,000 claims/month | $162/month |
| every IG-having artist claimed | $4,707 one-time |

So it is free today and becomes a real line item precisely when claiming starts working, which is
the thing we are trying to make happen.

**What it buys.** Thin, and thinner for the artists who need help most:

```
Pete Rango    299 posts →  38 coauthored,  37 track credits
Pharaoh        60 posts →   0 coauthored,   4 track credits
```

Pharaoh's run is the one at the real onboarding limit. It cost $0.162 and returned **no
collaborators at all**. Halving the limit to 30 does not fix that — it buys less of nothing more
cheaply. And the signal it does produce ("Instagram collaboration with @kevaux__") is exactly what
`DOC_SYSTEM_INSTRUCTION` forbids writing down: a bare handle with nothing said about what the
collaboration was.

Worth weighing against where the quality actually came from this week — the interview extraction
fix, the quotes section, publication dates. All free.

**The options.**

1. **Leave it in onboarding.** Simplest. Questions can be grounded in real posts during the flow,
   which is the only thing that has ever made a generated question feel specific.
2. **Move it after profile generation.** Per-claim cost goes to zero and the spend becomes
   discretionary. It is already off the critical path — the build finishes in ~19s and the scrape
   runs in the background at the interview step — so nothing in the flow slows down without it.
3. **Where Pete wants it to end up:** scrape *after* the profile exists, and use it to drive
   follow-up emails that ask the artist about specific posts on their Instagram and TikTok. That
   turns a cost centre into the engagement loop from [4.3](#43-weekly-follow-up-emails-todo), and
   it means we only pay for artists who came back.

The mechanics are ready either way: `ensureRecentSocialPosts` is idempotent and flow-agnostic on
purpose, so moving it is deleting one call at `turnHandlers.ts:1188` and adding a trigger wherever
the follow-up job lands. TikTok is the open question for option 3 — see
[2.16](#216-tiktok-cannot-be-probed-at-all-done-as-far-as-it-goes); we cannot even confirm an
artist has one, let alone read their posts.

---

## Suggested order

1. **3.2** — an hour of copy, and it partly fixes 2.2.
2. **1.3 + 1.4** — both visible in one screenshot, both client-state bugs, both make the flow feel
   broken in front of an artist.
3. **1.1 + 1.2** — the highest-value feature in the demo, currently doing nothing.
4. **2.1 + 2.2** — investigate together.
5. **3.1** — structural, and it should land before 4.1 rebuilds the flow around it.
6. **4.x** — take to Carl and CY on Thursday first.

## 5. The interview should be opt-in, and repeatable

Decided 2026-08-26 with the product owner. Today the interview is three
questions, asked once, at claim time, and never again; the "follow-up bank" the
spec describes exists only as a `source: "onboarding" | "followup"` string union.

The shape we want instead:

1. **An invitation, not a step.** Once a profile has generated, offer it:
   "Want to be interviewed by Music Nerd?" Yes or no. The offer has to say what
   the answers are used for and what the artist gets out of answering, because
   right now we ask three questions and the answers vanish into synthesized
   prose with a citation number on them.
2. **An "Interview me" button in edit mode**, so an artist can start one
   whenever they want rather than only in the minutes after claiming. Questions
   are generated from the posts we think are currently relevant.

This replaces "three questions, once, forever" with something the artist opts
into and can return to. It also gives the grounded-question work somewhere to
land: an artist who releases something new has new posts, and therefore new
questions, without us having to email them.

Not yet decided: whether there is ever an email path. Return visits come first.

## 6. Caption extraction needs a durable job, not a request callback

Found by review, 2026-08-26, and NOT fixed.

The Instagram ingest and the caption extraction are scheduled with `after()`
from the onboarding turn. `after()` work is bounded by the route's
`maxDuration`, so the whole callback shares the request's ~60 seconds. A scrape
takes one to five minutes. Extraction takes about seventy seconds for a
sixty-post feed and roughly seven minutes for a three-hundred-post one.

So for a genuinely fresh artist the platform stops the invocation partway and
the credits never arrive — which means the primary onboarding flow still
produces a document with none of this work in it, even after the hook was added
to `runAutoBuild`.

It works today only where the posts are already stored and the feed is small,
or where they were pre-warmed by hand.

The fix is a durable job: enqueue the ingest and the extraction, run them
outside the request lifecycle, and rebuild the document when they finish. That
is infrastructure this repo does not have, and it should not be improvised at
the end of a long night. Until it exists, treat pre-warming as the mechanism
and the hook as best-effort.
