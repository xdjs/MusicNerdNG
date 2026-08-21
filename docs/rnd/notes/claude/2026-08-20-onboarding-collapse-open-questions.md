# Collapsing the onboarding flow — what I'd want settled first

Written after the 8/20 meeting, before touching the code. Not a design — these are the questions
I think decide the design, so they're worth answering before anyone starts building.

## The direction

Carl's ask: one assertion, then the profile. Build it best-effort with no further input, and put
the editing affordances on the profile page.

The current flow has roughly six steps between claiming and seeing anything. Every one of them is
a place to abandon before the payoff has been shown.

## The tension nobody named out loud

The current flow's steps aren't only collecting data — several of them are **producing the thing
that makes the profile good.** Approving discovered links feeds the vault. The vault feeds the
About. Answering the Instagram-derived questions feeds the knowledge document.

So "get them to the profile fast" and "the profile is worth arriving at" pull against each other
at the moment of first arrival. If we skip everything, the profile they land on is thinner than
the one the current flow produces — which is the exact experience Carl wants them to have a
reason to care about.

Three ways out, and I don't think the meeting picked one:

1. **Front-load nothing, run discovery in the background.** They assert one social, land on the
   profile, and it fills in while they're looking at it. Best experience if it works. The About
   pipeline already has measured discovery latency in the 12–33s range with intermittent empty
   returns (see `MEMORY.md`), so "while they're looking at it" is plausible but not free — and
   the known `waitUntil()` gap means background work on Vercel isn't reliably finishing today.
2. **Land them on a deliberately partial profile** and let the affordances do the work. Honest,
   simple, and it makes the editing affordances load-bearing rather than optional.
3. **Keep one enrichment step, drop the rest.** Probably the link approval, since it's fast and
   feeds everything downstream.

My read: (1) is the right target and (2) is what we can ship now. Worth deciding explicitly
rather than discovering it halfway through.

## Questions I'd want answered

- **What does the profile look like at t=0?** Nobody has seen the version of the profile that
  exists before any onboarding input. That's the actual thing being proposed and it hasn't been
  demoed. Building it and looking at it would settle a lot of this cheaply.
- **Wizard or per-section affordances?** The meeting listed both and picked neither. These aren't
  equivalent-cost — a wizard is a new surface, per-section affordances mostly extend the edit
  mode that already exists.
- **What happens to the questions?** The Instagram-derived questions were the most interesting
  part of the demo and the part furthest from "get them to the profile fast." Pete's follow-up
  email idea is the natural home for them, which would mean pulling them out of onboarding
  entirely rather than shortening them.
- **Does "feeling seen" survive the collapse?** CY's bar was that the artist comes out feeling
  seen in a way they didn't expect. Some of that came from being *asked* good questions, not just
  from being shown a good profile. If the questions move to email, the onboarding moment needs
  its own way to hit that.

## Small things from the demo worth not losing

- Website URLs fail validation in the "anything we missed" step. Real bug, seen live.
- Subvert doesn't surface in discovery; had to be added by hand. Both Subvert and Bluesky exist
  as platforms in `urlmap` already, so this is a discovery-coverage gap, not a schema gap.
- The knowledge document's section list is inherited from Recoupable and hasn't been re-cut for
  what Music Nerd cares about. "Career highlights" and "sound and influences" both produced
  output Pete disagreed with — and "sound and influences" is arguably the section an artist
  should own outright rather than have generated.
- Spotify ID at artist creation is an independent requirement (Sleeve Note, Bopping) and
  shouldn't get entangled with onboarding work.
