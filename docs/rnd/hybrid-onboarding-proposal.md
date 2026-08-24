# Hybrid onboarding — a concrete proposal

Carl's direction from 2026-08-20 (one assertion, then the profile) worked through against what a
week of real artist testing actually showed. For reaction, not approval.

Related: [what the chat is for](notes/claude/2026-08-21-what-the-chat-is-for.md) ·
[the artist test](research/2026-08-21-artist-test-pharaoh.md) · [fixes](onboarding-fixes.md)

---

## The evidence that should shape this

**Nobody complained the flow was long.** Pharaoh, unprompted, called it *"a pretty streamlined
process."* He still preferred Carl's version — with a reason: *"as I was typing that out, I was
like, this is basically my Spotify bio."* He wasn't asking for fewer steps. He was asking not to
supply what we could already know.

So the goal isn't brevity. **It's arriving at something already correct.** That distinction
changes what "done" looks like: a three-step flow that produces a wrong profile is worse than a
six-step flow that produces a right one.

**Every bug found this week was in the parts that ask the artist to decide.** The card lost his
confirmations on re-search. It lost every discovered profile because it was opt-in while
instructing him that leaving it alone would confirm. It said "Still missing: TikTok" directly
below the TikTok link he'd just added. It asked about a post from 2020. It offered him his own
Spotify page as a source *about* him.

The parts that just *do work* — catalog resolution, discovery, verification — have been fine, and
are now measurably so.

**That is the argument for the hybrid, and it isn't the one from the meeting.** Not "fewer steps
so they don't abandon", but: *the asking machinery is where we keep getting it wrong, so ask less
and ask better.*

## The principle

**The chat carries only decisions where being wrong contaminates everything downstream.**

Identity is the only genuinely irreducible one. The database holds three Black Daves; the web
holds a fourth (a UK rapper) and a Chord DAVE audio DAC whose review threads keyword search
returns happily. No amount of search quality fixes that. One human answer does, permanently.

Everything else is recoverable, and recoverable decisions belong next to the thing they're about
— not in a gate before the artist has seen anything.

---

## The flow

### 1 · Before the artist arrives — nothing asked

Triggered on claim approval. All of this already exists and is verified working.

- **Reciprocal platform IDs** — Carl's `findReciprocalArtistIdentity` (#1170/#1171) resolves
  Spotify↔Deezer via Wikidata at artist creation.
- **Profile discovery** — three tiers ending in a real search API. ~5s measured.
- **Source discovery** — Tavily, fetched and verified, namesake-gated. 5–13s measured across
  three artists; zero dead URLs, zero namesakes citable.
- **Instagram ingestion** — `after()`, ~58s for 60 posts. Feeds questions, not the About.
- **The About** — synthesised from whatever verified.

**Open risk, stated plainly:** discovery plus synthesis is 30–60s. "Already built" therefore means
either the artist waits, or the page fills progressively while they look at it. Progressive is
better and is not built. This is the main engineering cost of the hybrid.

### 2 · The one question — the 99.9% moment

A single card. Their photo, their name, their top track, follower count — pulled from the platform
ID we resolved.

> **Is this you?**   [Yes, that's me]   [Not quite]

**Yes** commits everything from step 1 and drops them on their profile.
**Not quite** opens today's profiles card, which is the right tool for a genuinely ambiguous
identity and stays for exactly that case.

Why this question and no other: it's answerable in one second by *looking*, it's the only
decision that poisons everything if wrong, and a photo plus a track name is a far better identity
check than a list of URLs. Note Pharaoh's and Pete's runs both had unambiguous identity — the
one-question path would have been correct for both.

### 3 · They land on the profile — already built

This is the payoff Carl wanted them to reach before being asked for anything.

### 4 · Affordances, not a wizard

Carl named both options and picked neither. **Affordances**, for a specific reason: a wizard is a
gate wearing a different hat. It still blocks the payoff and still asks for decisions before the
artist has context. An affordance on the thing itself gives context *first* — "here's your About"
→ "fix it" — which is what Pharaoh was asking for.

| Section | Affordance | Why here |
|---|---|---|
| Links | "Any of these wrong? Anything missing?" | wrong link poisons the catalog anchor and every search query |
| About | "Written from N sources — edit, regenerate, see sources" | Pharaoh wanted to shape it; provenance answers "where did that come from" |
| Sources / press | **"Not me"** on any source | the highest-value action in the product — see below |
| Questions | *none* | moves to email |

### 5 · Questions move to email

Verified working and better placed there. YouTube transcripts give real verbatim material
(*"Thank you all for being here and thank you for having me at Shockoe Sessions in your ear"*),
recent-post signals now actually respect recency, and email removes the race against a 58-second
scrape and an 80-second transcription entirely.

It also fixes what onboarding questions can never be: **timely.** "We noticed you posted this"
is a real sentence in an email and a strange one during signup.

---

## The thing this proposal is really about

**Rejection is the highest-value action in the product, and it currently has no home.**

Pete's own run produced six rejections — Pete Davidson, Pete (Disney), the *Rango* soundtrack,
Peter Calandra, a ProduceLikeAPro interview, a Facebook account. Every one a namesake. Black
Dave's produced Chord DAVE audio-DAC reviews and Dave the UK rapper.

Those aren't unlucky URLs. They're **entities the web has endless pages about**, and we will keep
finding them forever. URL-level rejection (shipped 8/21) stops a repeat; it demonstrably does not
stop the next one — rejecting two Chord DAVE pages immediately surfaced two more from other
domains.

**"Not me" should teach the system, per artist, permanently.** That is the only mechanism here
that compounds: every rejection makes the next run better, for that artist, forever. It's also
the only one that scales past our ability to tune heuristics.

And note the asymmetry that makes it safe: **rejection is deliberate, approval is the default.**
The vault card approves anything untouched, which is how Pete's own Spotify page ended up
"approved" as a source about him. Trusting approval would mean treating *didn't read it* as
*verified this*. Trusting rejection means treating a deliberate click as a deliberate click.

---

## How we'd know it worked

Testable with `scripts/verify-discovery.ts` against Pharaoh, Black Dave and Pete:

- An artist is never shown a source they already rejected. *(URL level: done. Entity level: not.)*
- An artist never re-confirms a profile they already confirmed. *(done)*
- Nothing the artist explicitly affirmed is silently unused. *(open — 2.6)*
- The About cites only material that passed machine verification **and** wasn't rejected.
- A new artist reaches a correct profile having answered **one** question.

## Open questions I can't answer for you

1. **Does "Not quite" happen often enough to matter?** Both test artists had unambiguous identity.
   If it's rare, the fallback can stay rough. If it's common, it's the real flow.
2. **How much wrongness is acceptable in the pre-built profile?** Pre-building means committing
   our best guess before the artist looks. Today's verification makes that defensible; it wasn't
   two weeks ago.
3. **Does the artist ever come back to the affordances?** If not, pre-build quality is the whole
   product and the affordances are decoration. Worth designing an email that pulls them back.
4. **Wizard for first-timers?** Affordances assume the artist explores. A one-time guided pass
   might do better for someone who has never seen the page — testable both ways.
