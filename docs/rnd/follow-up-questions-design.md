# Follow-up questions: what gets asked, when, and where it comes from

Pete, 8/23: *"what are the set of questions that would be sent out and in what cadence for an
artist to answer? and when would those questions be created and how does it pull from instagram
to keep the questions current and how does it explore the past?"*

Worked against Pete Rango's real data: 299 Instagram posts spanning 2018-05 to 2026-08, a
knowledge document built from two interviews (2019 and 2024), and a Spotify catalog of 24 releases.

---

## The gap this closes

His document's origin story: taught himself guitar at nine, metal band in high school, discovered
electronic music in 2008, i-Standard win, `Vi$ions` on *Insecure*, Dead Set FC.

His feed, which the document has never read:

| when | what |
|---|---|
| 2018-05 | *"My mom sacrificed everything to bring my brother and I to the US"* |
| 2018-05 | *"over the last year we've been helping our VA sister @cocomamba produce her new project Neptune"* |
| 2026-05 | *"@subvertworld is now officially open... artists need more than another place to upload music"* |
| 2026-05 | *"my cousin André... handed me 112's Part III and Dr. Dre's 2001. The first time I had ever heard modern R&B"* |

Two interviews gave us a career. Eight years of posts hold the actual story, and none of it is in
the document. **The email is how that gets in** — not by scraping harder, but by asking him.

---

## Four wells, deliberately different

Questions come from four places. They are not interchangeable: each has its own trigger, its own
supply, and its own termination condition. A generator that treats them as one pool produces the
shallow output of 2.3 ("your captions mention 'single' a lot").

### 1. CURRENT — what happened since we last wrote
Source: own-authored posts newer than the last email, with a substantial caption.
Terminates: never; refills as they post.
Supply for Pete: bursty. 3 posts in all of 2025, 44 in 2026.

> *"You wrote that Subvert matters because artists need ownership and context built in, not just
> another place to upload. What convinced you it was that one?"*

### 2. PAST — the archive, walked backwards
Source: own-authored posts older than everything already asked about, oldest first.
Terminates: when the archive runs dry. For Pete, ~200 posts with real captions, so at one a week
this well alone runs for years.
This is the half that makes it a music database rather than a news feed.

> *"In 2018 you spent a year helping @cocomamba produce Neptune. What did that project teach you
> that you still use?"*

### 3. GAPS — entities the document names but cannot explain
Source: collaborators and releases in the document with nothing said about them. Exactly the
`@kevaux__: Confirmed Instagram collaboration` problem — the document is forbidden from padding
with bare handles, so instead of inventing context we ask for it.
Terminates: when everything named is explained.

> *"Elle Symone is on both 'Breakdown' and the WILD LIFE EP. How did that start?"*

### 4. DECAY — claims that may have quietly stopped being true
Source: claims the document scoped with `as of YEAR`, oldest first. This is the real fix for 2.12:
publication dates let us SCOPE a stale claim, but only the artist can REFRESH it.
Terminates: when nothing is stale.

> *"Our page still says Parris Pierce is your production partner, from a 2019 interview. Still
> true, or should we put that in the past tense?"*

---

## Cadence

**Weekly ceiling, supply-gated. One to three questions. Never a full form.**

Not "weekly" flatly — his 2025 had three posts in it, and a scheduled email with nothing real to
ask is how an artist learns to ignore us. Send only when a well produces something.

Mix rule, at most one from each: **1 CURRENT + 1 PAST + 1 GAP-or-DECAY.** Every email is then
partly about now and partly about the archive, which is what stops it feeling like either a news
alert or an interrogation about 2018.

Escalating backoff on silence: after two unanswered emails, drop to fortnightly; after four,
monthly. An artist who never answers should cost us almost nothing.

---

## When they get created

**At send time, never in advance.** A CURRENT question about a three-week-old post is fine; the
same question stored for two months is embarrassing. Generation is cheap (one ungrounded Gemini
call over signals we already hold) and staleness is not.

Ordering matters and gives us the answer to 4.5:

1. Refresh the scrape (Apify) — **only for artists still engaging.** This is where the $0.162 per
   artist belongs. Not at claim, where we pay for everyone including the artist who claims and
   never returns, but here, where we pay for artists who came back. Same money, spent on the
   people who are actually using it.
2. Derive signals + read the document for gaps and stale claims.
3. Generate 1-3 questions across the wells.
4. Send. Record which posts and claims were asked about, so PAST advances and nothing repeats.

Answers land as interview answers, which already feed the document, the Ask section and the About.
So the document gets richer every week without anyone writing prose — the compounding loop 4.3 was
always after.

---

## What must NOT be asked

Not every post is material. In his most recent 120 days, two of the three substantial posts are
his cousin's death and an earthquake appeal; going back to 2018, one is the anniversary of his
father's death.

**Grief, illness, family loss, disasters and political violence are not prompts for "tell us
more."** A generator that treats a eulogy as content will eventually send an artist a cheerful
request to elaborate on their father dying, and no amount of good output elsewhere survives that.

The André post is a genuine origin story — 112 and Dr. Dre as his first modern R&B — and it is
still off limits in the framing he wrote it in. If that thread is ever pulled it is pulled at the
music, never at the loss, and never in the same week he posted it.

Needs a classifier pass over candidates before generation, erring hard toward silence. Nothing
here is worth one bad email.

---

## Open, for the team

- Email or in-product? An email is where artists are; the answers need to land back in the profile.
- Who signs it? "Music Nerd" or a person.
- Does an answer publish straight to the profile, or wait for review? The document already only
  builds from approved material, so this may already be answered.
- Does the artist see what their answer changed? Set against CY's "feeling seen" bar, an answer
  that vanishes into third-person prose reads as harvesting. Same question as the open decision on
  where interview answers get displayed.
