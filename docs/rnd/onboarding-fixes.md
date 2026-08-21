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

### 2.1 Hallucinated links still appearing `todo`
Seen live on a YouTube interview. Not yet investigated. Needs the actual bad output captured
before guessing — which tier produced it (id mappings, platform search, or scoped web search),
and whether verification was skipped or passed something it shouldn't.

### 2.2 Discovery missed the press that exists about him `todo`
He has at least one article written about him; discovery surfaced none of it. Unclear whether
that's a query problem, a verification problem, or the same root cause as 2.1. Investigate with
2.1 — they may be one bug.

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
