# What the chat window is for

Pete, 2026-08-21, on where Carl's collapsed flow should land:

> a hybrid with what should stay in the pop up chat window that would make sense to be 99.9% we
> lead our research process and profile build in the correct way

That's the right question, and it has a principled answer rather than a taste-based one.

## The principle

**The chat carries the decisions where being wrong contaminates everything downstream.**
Everything else can be pre-built, deferred to the profile page, or moved to email.

Ranked by how far an error propagates:

| Decision | Cost of getting it wrong | Where it belongs |
|---|---|---|
| **Which artist is this** | every subsequent step is about someone else | **chat — non-negotiable** |
| **Which profiles are yours** | poisons discovery *and* the About | **chat** |
| Which sources are about you | the About is wrong, but recoverable | profile page affordances |
| Your story | profile is thinner, not wrong | weekly email |

Identity is the only genuinely irreducible one. We cannot resolve it ourselves — the database
holds three Black Daves, and the web holds a fourth (a UK rapper) plus a Chord DAVE audio DAC.
No amount of search quality fixes that. One human answer does, permanently.

That is what "99.9%" buys: not a better guess, but the elimination of the residual uncertainty
that would otherwise contaminate the catalog anchor, the source discovery, the About, and every
question we ask afterwards.

## The corollary nobody has been treating as load-bearing

If the chat exists to capture the artist's judgment, **that judgment has to stick.** Today it
leaks at four separate points:

- **1.3** — artist pastes a TikTok link; the card still says "Still missing: TikTok"
- **1.4** — artist confirms four profiles; "Look for more" discards all four and re-offers them
- **2.8** — artist rejects a source; the next discovery run may re-surface it
- **2.6** — artist approves their own interview; it still can't be cited in their About

Four leaks in the one mechanism whose entire job is capturing what the artist tells us. You
cannot reach 99.9% while the instrument you'd use to get there drains out. This is also,
probably, why Pharaoh said *"it was a little confusing, I wasn't entirely sure what it was
doing"* — a system that discards your answers doesn't read as one that's listening.

**These should be fixed as one piece — "the artist's answer sticks" — not as four tickets.**

## What this changes about the collapse

Earlier advice in `onboarding-fixes.md` said to hold 1.3/1.4 until we knew whether the profiles
card survives Carl's restructure. Under the hybrid, that's backwards: identity confirmation is
the *highest*-contamination decision, so the profiles card is precisely the part that stays.
Those bugs are core, not throwaway.

What moves out of the chat:
- **Vault curation** → profile-page affordances. Getting a source wrong is recoverable and the
  artist can fix it any time.
- **Interview questions** → the weekly email. They're additive, they're the richest thing we do,
  and email removes the race against a 60-second Instagram scrape and an 80-second YouTube
  transcription (see 4.3).

What stays, and gets *better* rather than shorter:
- **One identity assertion**, anchored on a verified platform ID.
- **Profile confirmation**, because a wrong link poisons the catalog anchor and every search
  query built from the artist's name.

## The measurable version

If the hybrid is right, these should hold after it ships:

- An artist never sees a source they already rejected.
- An artist never re-confirms a profile they already confirmed.
- Nothing the artist explicitly affirmed is silently unused.
- The About cites only material that survived both machine verification *and* the artist's yes.

Those are testable against Pharaoh and Black Dave with `scripts/verify-discovery.ts`, which is
the point of having it.
