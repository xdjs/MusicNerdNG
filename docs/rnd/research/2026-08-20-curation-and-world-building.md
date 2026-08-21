# Curated listening products & world-building artist sites

Source: R&D discussion 2026-08-20. Two threads that turned out to be about the same thing —
how you help someone go deeper on music instead of wider.

## Curated-listening subscriptions

**Bandcamp Clubs** and **Cantilever** both came up. The team had used both. Neither held up.

The shape of both: you pay in advance, someone picks an album for you, and there's a chat where
people type at each other while listening. Cantilever adds long editorial text on top. Bandcamp
Clubs is hard to unsubscribe from.

The substantive criticisms:

- **No new thinking.** The concept would have been mildly interesting ten or fifteen years ago.
  It's Columbia House with a chat window.
- **Editorial volume without editorial value.** Walls of text that don't earn the reading.
- **Streaming-shaped**, which undercuts the premise of deliberate listening.

Worth noting Carl's comparison: the MNTV experiments were judged an order of magnitude more
interesting than either, even unpolished and incoherent as a product, because the ideas
underneath are better thought through.

### What's actually true about curation

There *is* a real audience for curated experiences. The failure isn't the category.

**Curation lands when you have a personal connection to the curator.** If you've found a DJ
whose taste you want to inhabit — "I want to be that guy" — and that person runs a club or a
channel, it works. That's the whole mechanism.

**Absent that connection, a system that knows your stated curiosities beats a generic
tastemaker.** It can tie together non-obvious connections across a large index in a way a single
editor picking one album a month cannot.

Pete's own evidence: a daily GPT "Music Nerd report" built around his stated curiosities held his
attention for the better part of an hour — it surfaced Cuban artists working in noise rock and
shoegaze, which is exactly the Latin-blended-with-other-genres thing he'd been looking for. The
club subscriptions did not. Ironically the thing that surfaced it *was* a Bandcamp club's writeup
on Cuban artists — the content was good, the subscription wrapper around it was the part that
didn't need to exist.

### Music Nerd's position

> We're not trying to tell you what to listen to. We're helping you fall in love with what
> you're listening to — deepening the relationship with music you already love. We're not telling
> you what your taste should be.

Related: the Pigeons & Planes piece on the gap between how much music we listen to and how little
of it we actually know. Most of us can't recite the lyrics of artists we stream constantly.
Endless supply built that. Worth revisiting — it's close to the core problem Music Nerd exists
to solve.

## World-building artists and breadth of work

Jamie's new Sound of Fractures site was the entry point. It's built around memory,
participation, and connections between his work — a network/map view with an archive view as the
alternate.

**The reaction:** mind-map fatigue is real. Pete's instinct was against seeing the whole picture
at once — he wants to start somewhere and get lost, not be handed the map. The archive view is
the dry, traditional counterpart: more navigable if you're thinking literally, arguably not
better.

Prior art in the same territory: Excellencia's earlier site, a star-diagram version of the same
idea, with a map view and an archive view behind a toggle. The criticism then was the same
criticism now — clicking in, backing out, clicking in, backing out, like navigating a 1997 portal.
Exploration as a requirement is annoying.

Pete's own thinking has been going toward hypermedia — everything richly linked — but the
unsolved part is return paths. Follow a link out of an artist's world and there's no way back in.

### The insight worth keeping

CY split it into two problems that don't need solving together:

1. **Convey that the artist's work isn't limited to one media type, and convey the scope of it,
   immediately on arrival.** Some kind of map, graph, or diagram is genuinely useful here. You
   came in through one vector; you should perceive the whole body of work right away.
2. **Let someone drill into a specific piece.** A different mechanism entirely — a gallery, an
   index, something linear.

The Will Smith example: you arrive through "Parents Just Don't Understand," and you should
immediately register that he was also a TV star, made features, directed. You don't need to watch
Men in Black at that moment — you need the breadth to be perceptible on arrival.

**Every world-building artist has this problem.** Nobody has solved it well. And it's not a
link tree — the point is to tie together the fact that someone does research *and* makes music.
Currently there's no way to make that leap unless you happen to stumble into an artist's
Substack.

CY named this as **the distinctive thing for Music Nerd to solve early** — when someone asks
Music Nerd about an artist, it should be able to represent the full scope of that artist's world.
Adjacent to what Utopia was once supposed to do.

## Recoupable

Pete revisited Recoupable's onboarding, which is what the current Music Nerd flow is riffing on.
Everything he liked about it is gone — feed it a new artist now and it just confirms the artist
exists. He emailed Sweet to ask what drove the change.

Their GitHub showed **Apify** and **Perplexity** in the stack. Apify is what makes the
Instagram-derived onboarding questions possible in the current Music Nerd flow — the thing that
couldn't be done before.

## Open questions

- What does a "show me the scope" view look like that isn't a mind map and doesn't require
  clicking around to understand?
- Where do the roundtable and showcase conversations attach in the database — artist, song,
  scene, place, or all of them?
- If AI can generate a custom site per artist on request, what does that mean for the shape of
  this problem in a year?
