# Artist test — onboarding, 2026-08-21

First cold test of the post-claim onboarding with a real artist. Pharaoh Sistare, in the room
with Pete, run without coaching per Carl and CY's instruction on 8/20.

*Names used with the artist present and participating. Raw transcript not committed.*

---

## The headline finding

**He found the flow short.** Asked what he liked, unprompted, first thing:

> A pretty streamlined process. It just keeps going down, and there's not too much clicking
> elsewhere you have to do.

That cuts against the premise of the 8/20 decision to collapse the flow. Carl's reasoning was
that artists would abandon before seeing the payoff — but the one artist who has actually walked
through it described it as streamlined and never mentioned length.

**Don't over-read it.** He was sitting next to Pete, who he knows, having agreed to test
something. Abandonment pressure in that setting is close to zero, which is exactly the pressure
the collapse is meant to relieve. One friendly in-person run is not a funnel.

But it is the only real evidence either way, and it should reach Carl before we rebuild the flow
around the opposite assumption.

## What he actually wanted

**Synthesis, not transcription.** The clearest ask in the session:

> I wish it could take what I provided and make an editorial version of it, versus just repeating
> exactly what I gave it.

His reference point was pasting a short excerpt into ChatGPT and getting something expanded back.
What he got instead was his own words handed back to him — to the point that he noticed
mid-session that what he'd typed *was* basically his Spotify bio.

This is in direct tension with the About work from the last two weeks. The generator carries a
"mine, don't summarize" mandate and a deliberately factual voice, both added to stop the
hallucination and relationship-inflation problems. Pharaoh is asking for the thing that work was
built to prevent.

Worth naming as a real design question rather than a bug: **where is the line between
editorialising and inventing?** He wants shaping. The guardrails exist because shaping is how
the Black Dave conflation happened. Both are correct.

Related: he assumed his Spotify bio was the natural source. It isn't available — Spotify's API
doesn't expose artist bios — so he ended up retyping it from memory.

## What confused him

**The "add more links" step doesn't say what to add.**

> When it asked if these profiles were mine, it didn't say to put in links that have my identity
> attached to my music. It just asked for profiles that are mine. And then it said "add more,"
> but it didn't specify adding things like publications.

This is why the run surfaced no press about him. He *has* an article written about him, and he
didn't add it — not because he was unwilling, but because the copy asked for "profiles" and he
read that literally as social profiles. The step that could have captured his press asked the
wrong question.

Cheap fix, high value. The copy needs to name the categories: publications, interviews, features,
your own site.

**And more broadly:** "It was a little confusing. I wasn't entirely sure what it was doing." The
flow doesn't explain what it's looking for or why, at the moment it asks.

## Bugs seen live

- **No Instagram-derived questions were asked.** Root cause found — see below. This is the
  feature Carl and CY reacted most strongly to on 8/20, and it silently did nothing.
- **Discovery found none of the press that exists about him**, though at least one article does.
- **Something hallucinated on a YouTube interview**, caught by Pete during the session.

## What he endorsed

Both with genuine interest, but both in response to Pete describing the idea rather than
experiencing it — so treat as directional, not validation:

- The collapsed "is this you? → we build it → you review" flow: *"Yeah, that would be cool."*
- Weekly emails asking about recent posts: *"Yeah, that'd be cool."* Pete's framing — somewhere
  documenting your story without it having to be a formal interview — landed.

These were leading questions. Real validation is watching an artist use it, not asking whether
they'd like it.

---

## Root cause: why no Instagram questions

**The app never ingests Instagram posts.**

`ingestInstagramPosts()` in `src/server/utils/socialIngest.ts` is what calls Apify and writes
rows. Its only caller is `scripts/ingest-social.ts` — a manual CLI script. No route, no turn
handler, no server action calls it.

The chain:

1. `questionGenerator.generateGroundedQuestions()` calls `getSocialPostsForArtist()` — a **read**.
2. For Pharaoh that returned `[]`. He has **0 rows** in `artist_social_posts`.
3. `if (posts.length === 0) return []` — silent empty return. No error, no log, no signal.
4. The interview step falls back to ungrounded questions. He got 3, none grounded in his posts.

**It worked for Pete because he had manually run the ingest script against his own handle while
building it — 299 rows in `artist_social_posts` against Pharaoh's 0.** The feature has only ever
run on hand-seeded data.

So it isn't a failure of the Apify integration, the signal derivation, or the question prompt —
all of those work, as the Pete runs showed. **The ingestion step was never wired into the flow.**

Also noted: `artist_social_profiles` has zero rows for *both* artists, so that table appears
unwritten even on the working path. Worth a look when the ingestion gets wired in.

### Why it hid

The silent `return []` is what let this reach a real artist. A degraded path that logs nothing
looks identical to a working path with nothing interesting to ask about. Whatever the fix, the
empty case should be observable.
