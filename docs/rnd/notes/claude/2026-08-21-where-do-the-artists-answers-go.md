# Where do the artist's answers actually go?

Pete raised this while we were wiring the Instagram ingest, and it's a better question than the
one it came out of. Two parts.

## 1. When do the questions get asked, if the flow collapses?

Under Carl's direction — claim, confirm one thing, we build the profile, then a guided review —
there is no interview *step* to hang questions on. The step is the thing being removed.

Three places they could go:

- **Inside the guided review.** They become one of the panels the artist is walked through:
  here's your About, here are your links, and here's something we noticed you posted about.
  Keeps them in the first session, which is when the artist's attention is highest.
- **Out of onboarding entirely, into the email cadence.** The weekly "we noticed you did this,
  tell us more" loop Pete has wanted from the start, and which Pharaoh endorsed. Onboarding gets
  shorter for free, and questions arrive when there's actually something new to ask about.
- **Both** — one question in the review to demonstrate what the thing does, the rest by email.

I'd lean on the third. The first question isn't really collecting data; it's teaching the artist
that this is a place where their own account of their work lives. One is enough to show that.
The rest is better asked when a post is fresh.

Note the timing argument for moving them out: the scrape takes 1-5 minutes, and it's a race
against the artist's own progress through the flow. Asking by email removes the race entirely.
The wait we just built is a workaround for a problem the restructure could delete.

## 2. Where does the answer get *displayed*?

This is the part with no answer today, and I think it's the sharper problem.

Right now an artist's answer is pure input. It feeds the knowledge document, which feeds the
About and the Ask section. The artist types a real story about why they made something — and it
comes back to them dissolved into third-person prose, or not visibly at all.

Set that against the bar CY named on 8/20: the artist should come out **feeling seen in a way
they didn't realise they could be perceived.** An interview whose answers vanish into a synthesis
doesn't feel like being seen. It feels like being harvested. And it's the same complaint Pharaoh
made from the other direction — he could tell the output was just his own words handed back.

Options, roughly in order of how much I'd want to try them:

- **"In their own words" on the profile.** Short verbatim quotes, attributed, attached to the
  release or moment they're about. The artist sees the exact sentence they wrote, presented as
  theirs. Cheapest to build and the most direct answer to "feeling seen".
- **Attached to the release.** The answer sits on the track it's about, so someone arriving at
  that song gets the artist's own account of it. This is the version that makes the *listener*
  care, not just the artist — closer to "helping you fall in love with what you're listening to."
- **A running timeline.** Accumulates as the weekly emails come in. Strongest over months, worth
  nothing on day one, which is the wrong shape for onboarding.

The second is the one that connects to the world-building thread from 8/20 — an artist's answers
become part of the scope of their world that a listener can perceive on arrival, rather than raw
material for a bio.

## Why this matters before the collapse gets built

Both the collapse and the ingest wiring assume the questions are a data-collection mechanism. If
the answers are also *content* — something the artist and the listener both see — that changes
where the questions live, how many you ask, and what a good answer looks like. Worth settling
before 4.1 in [`onboarding-fixes.md`](../../onboarding-fixes.md) gets built, not after.
