# Decision log

An **index**, newest first. One line per decision plus who made it. The reasoning lives in the
meeting notes — follow the link. Don't restate it here; two copies of the same decision drift.

A line goes here when something changes what we build or how we work. Still open? Bottom of the
file.

---

## 2026-09-02 · standup

**Product**

- Artist profiles and user profiles stay **separate notions** for now. SoundCloud merges the two;
  we're not doing that initially. — Carl, Pete
- A **latest-activity section** on the artist profile, surfacing the answers artists give to
  interview questions. These become the "nuggets" MNTv draws on, shown next to the artist's social
  updates with a call to action back to the source post. Agreed work, next up. — Carl

**How we work**

- **Releases:** reviewer green light → Pete tells Carl → Carl merges `staging` to `main`. Squash,
  per the `default` ruleset, which allows only squash and rebase and has no bypass actors.
- **Agents must write tests for each new feature.** Raised by Carl after a week where staging
  caught failures the local suite had missed. — Carl

## 2026-08-20 · [meeting notes](meetings/2026-08-20.md)

**Onboarding** — [reasoning](meetings/2026-08-20.md#decisions)

- Renaming "Social links" just "Links" seems more fitting for the time being.
- Collapse the flow to one assertion, then the profile; enrichment moves to affordances on the
  profile page. — Carl
- The one assertion is a social handle, not Spotify. — Pete
- Pre-select confident single matches. Where several candidates exist for one platform, don't
  surface them to be unchecked — let the artist add the right one. — CY
- Artists don't edit Markdown. Ship the current knowledge-document screen, redo the presentation
  later. — Carl
- Product copy says "Music Nerd," never "AI." — CY
- Artist tests run cold — no coaching, no narration. — Carl, CY
- The bar: the artist comes out feeling seen in a way they didn't realize they could be
  perceived. — CY

**Engineering**

- Every new artist gets a best-effort Spotify ID at creation, independent of onboarding. — Carl

**How we work** — [reasoning](meetings/2026-08-20.md#shared-context-in-the-repo)

- Shared context lives in this repo as markdown, not a separate system. — Carl
- Docs-only commits can go straight to `main`. — Carl
- The retro moves to 0:42 with ten minutes, from 0:51 with five. — from the retro

**Direction**

- Music Nerd doesn't tell you what to listen to; it deepens your relationship with music you
  already love. — Carl
- Show the scope of an artist's world on arrival; drilling into it is a separate problem. — CY

**Events** — [reasoning](meetings/2026-08-20.md#roundtable--showcase)

- Roundtable and showcase are monthly each — roundtable top of month, showcase end. — team
- Record in Riverside. — Pete, endorsed
- Invites go to the Music Nerd email list from Jade. Approved. — CY

---

## 2026-08-21 · [artist test](research/2026-08-21-artist-test-pharaoh.md)

**Product**

- An artist's own website is surfaced beside Links on the profile, not buried in the vault —
  stored as an approved vault source of type `website`, no schema change. — Pete
- "Social Links" is renamed "Links". — Pete

**Open questions this raised** (below)

---

## Open

Raised, not settled. Move up into a dated section when they close.

- **Drop the staging branch** for feature branches straight into `main`? Floated by Carl 8/20,
  not decided. Code still follows `CLAUDE.md`.
- **Wizard vs. per-section affordances** for profile editing — both named, neither chosen. Build
  both and compare. *(8/20)*
- **Does the knowledge document keep source references?** Pete wants provenance; artist edits
  leave unreferenced lines beside referenced ones. Carl suggested suppressing them. *(8/20)*
- **Does the artist want editorialising or transcription?** Pharaoh asked for "an editorial
  version" of what he typed rather than it being handed back verbatim. That is the exact
  behaviour the About's "mine, don't summarize" mandate and factual voice were built to prevent,
  after the Black Dave conflation. Both positions are defensible; the line between shaping and
  inventing needs drawing deliberately. *(8/21)*
- **Does the flow actually need collapsing?** The one artist who has walked it called it
  "streamlined" and never mentioned length — which cuts against the 8/20 premise. Weak evidence
  (in-person, friendly, zero abandonment pressure), but it is the only evidence we have. Worth
  putting to Carl before rebuilding around the opposite assumption. *(8/21)*
- **Where do the artist's answers get displayed?** Today an interview answer is pure input — it
  feeds the knowledge doc, the About, and the Ask section, and the artist never sees the sentence
  they wrote presented as theirs. Set against CY's "feeling seen" bar, an answer that dissolves
  into third-person prose reads as being harvested, not seen. And it's Pharaoh's complaint from
  the other side: he could tell the output was his own words handed back. Sketched in
  [notes](notes/claude/2026-08-21-where-do-the-artists-answers-go.md). Raised by Pete. *(8/21)*
- **When do the questions get asked if the flow collapses?** There's no interview step to hang
  them on once onboarding becomes claim → confirm → pre-filled profile. Inside the guided review,
  in the weekly email cadence, or one of each. Also deletes the scrape-vs-artist race the current
  wait works around. Raised by Pete. *(8/21)*
- **Wiring Instagram ingestion into the flow.** `ingestInstagramPosts` is called only by a manual
  CLI script, so the grounded-question feature has never run on data it collected itself. Needs a
  decision on where it triggers and what happens during the wait, given it's an Apify round-trip
  on a user-facing path. *(8/21)*
- **Does the Instagram scrape stay inside onboarding, or move after profile generation?** It is
  the only per-claim cost in the flow denominated in cash. **Leaving it on for now** — Pete, 8/22
  — and taking it to the team. Numbers and the emails-about-posts direction are in
  [onboarding-fixes 4.5](onboarding-fixes.md). *(8/22)*

- **How does one human hold several DSP artist profiles?** Sherwinn "Dupes" Brice has four Deezer
  entities and can claim one — compounds minted before multi-primary-artist support ("X & Hebrue")
  plus punctuation variants. `artists` holds one spotify and one deezer id per row, so there is no
  representation for it. Detection is easy; auto-merging is the name matching that produced three
  wrong-artist incidents in a week. Proposal is to ask at claim time and claim all in one action.
  Written up in [research](research/2026-08-24-identity-fragmentation-and-link-rot.md). Raised by
  Pete. *(8/24)*
- **How do we preserve a source after its publisher goes offline?** loopnews.com went down and took
  much of the Caribbean scene's written record with it. We now store article text, so a dead URL no
  longer empties a profile — but only for captures since 8/22, and we have no liveness check, no
  content hash and no independent copy. Pete raised blockchain; the split worth deciding is storage
  (database/Arweave) versus tamper-evident timestamping (hash on-chain), and what may lawfully be
  republished permanently versus held internally. Same
  [research](research/2026-08-24-identity-fragmentation-and-link-rot.md). *(8/24)*

- **How relationships in the database become explorable** — what counts as an edge, whether edges
  weigh equally, verified vs. inferred vs. artist-described. On the 8/20 agenda, never reached.

- **Do long-running jobs need a server of their own?** Vercel kills a function at 60 seconds, and
  the work that matters here does not fit: an Instagram scrape takes one to five minutes, caption
  extraction seventy seconds for a small feed and several for a large one. Running it inside the
  onboarding request meant the platform cut it off partway and the artist's credits never arrived.
  The current answer is `artist_research_jobs` plus a once-a-minute cron that takes as many slices
  as fit in an invocation and leaves a cursor behind — the work survives the request, at the cost
  of a queue to maintain and completion arriving minutes later. A dedicated worker would remove the
  time limit and the slicing, and add infrastructure we do not otherwise run. Not urgent while
  volume is low; the thing to watch is whether artists wait noticeably for a profile. Raised by
  Carl. *(9/2)*
