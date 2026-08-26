# Why a prompt beats our research pipeline

Pete, 8/24: *"we can't let a simple search on ChatGPT beat our system."*

Measured rather than assumed. Three gaps, one of them the opposite of what I expected.

---

## What we actually do

The whole of our retrieval, for any artist:

```
"<name>" music artist interview
"<name>" music review
"<name>" artist profile
```

Three fixed queries, five results each, one round, no follow-up. Every query contains the artist's
own name.

The literature has a name for this shape. Deep-research systems are distinguished from
**"Tool-Augmented LLMs that typically rely on single-turn retrieval"** by their ability to *"plan
multi-stage search strategies and execute dynamic, multi-turn retrieval"*, using either parallel
decomposition into sub-queries or **sequential reflection-driven loops that adaptively refine
search actions based on intermediate feedback**. We are the former category. ChatGPT is the latter.

---

## Gap 1: the best material is on a page about someone else

ChatGPT surfaced *"Yonder brought Pete into an intense recording session where they made 17 songs
in two days."* That fact lives on a page about **Yonder**. No query containing "Pete Rango" will
ever rank it.

## Gap 2: multi-hop raises precision — it does not lower it

I expected a second hop to multiply our namesake problem. Measured, it does the reverse.

**Hop 1 — his name alone.** 14 hosts, mostly wrong:

```
shoutsmusic.blog        Pete Murphy               wrong person
genemyers.wordpress     Pete Seeger               wrong person
screenrant / wikipedia / allmusic / designingsound   Rango, the film
soundbetter / rvamag    index pages
```

**Hop 2 — his name plus a collaborator we already hold.** 8 hosts, almost all real:

```
voyagemia.com     the real interview — hop 1 never found it
audiomack.com     "BTM" by Pete Rango, Elle Symone
genius.com        Cherele & Pete Rango
open.spotify.com  LIGHTSOUT — Cherele, Pete Rango
cherele.com       first-party ABOUT page for his closest collaborator
```

**A verified collaborator is a disambiguator.** "Black Dave" plus a real track title cannot return
a Chord DAVE amplifier. This is what the retrieval literature means when it reports that dynamic
query triggers produce *better factual accuracy AND reduced hallucination* — more hops, less
invention, because the model is working from evidence instead of parametric memory.

Every safeguard we built this month was a filter applied AFTER bad retrieval. The cheaper fix is
retrieval that cannot go wrong in the first place.

## Gap 3: we search one spelling of his name

`cfmusic.org/pete-arango` is a real page — he has advised the Campfire Music Foundation since 2023,
and it is one of the sources ChatGPT cited.

It appeared in **our own hop-1 results** and we would reject it, because our verification requires
the literal string "Pete Rango" and the page says **Arango**. He goes by both. "Campfire" is
meanwhile sitting in his LIFE CHANGES bio, in material we already hold and never mine for entities.

---

## The mechanical fix for the thing we keep patching

> *"Agentic hallucination is often entity-level, where models emit plausible identifiers from
> parametric memory instead of tool outputs, and grounding constraints require every entity in the
> final answer to appear in prior tool outputs."*

That is our entire bug history in one sentence: Black Dave the amplifier, the invented YouTube
video id, `[VERIFIED CATALOG]` cited as a source, `instagram.com/p/` becoming the handle "p".

We have been fighting it with prompt prohibitions — no hype, do not inventory, do not characterise,
at most six entries — which suppress invention and voice together. **The constraint is mechanical
and it belongs in code:** every entity in the output must resolve to something a tool returned. We
already do exactly this for `[n]` citation markers in `validateCitations`. Extending it to names,
titles and handles lets us delete the prohibitions that are strangling the prose.

That is the trade worth making. Verification gets stricter and mechanical; the writing gets free.

---

## What a prompt cannot have

ChatGPT sees released credits — a lagging, sparse signal. It cannot see:

- **Eight years of the artist writing in their own voice.** 98,138 characters for one artist. His
  cousin André handing him 112's *Part III* and Dr. Dre's *2001*, the first modern R&B he heard —
  an origin story in no interview anywhere.
- **A relationship graph with time and intent.** 38 posts tagging collaborators across 2018-2026:
  who he was in a room with, when, including everything that never became a release. A credit says
  two people finished something; a tagged post says they were working.
- **The artist.** Corrections that outrank any source.
- **Provenance.** Every claim traceable to a page with a publication date.

We currently reduce the first two to seven bullet points, and hold 123,812 characters against a
4,000,000-character context window — 3.1% of one window, distilled before the model is allowed to
think.

---

## The design that follows

**Code does what code is good at:** issue queries, fetch, verify a URL resolves, match an id
exactly, attach provenance, enforce corrections, and refuse any entity that did not come from a
tool output.

**The model does what it is good at:** read all of it, decide what connects, rank by evidence, and
tell it to someone who wants a way in.

Concretely, the retrieval loop becomes: seed from what we already hold (catalog, collaborators,
name variants) → search → read → extract new entities → search those → stop when a round returns
nothing new. Every expansion term comes from a real tool output, never from the model's memory —
which is what the literature calls retrieval-conditioned expansion, and is why it does not drift.

## Order

1. **Publish what we already write.** 5,153 characters exist, hidden behind an Edit button.
2. **Multi-hop retrieval seeded by entities we hold.** Highest measured gain, and it raises
   precision.
3. **Name variants** as a first-class concept, not one exact string.
4. **Hand over the corpus** instead of seven bullets.
5. **Entity-level grounding in code**, then relax the prose prohibitions.
6. **Then the graph**, which by then is mostly a rendering problem.

Sources: [Deep Research Agents: A Systematic Examination and Roadmap](https://www.alphaxiv.org/abs/2506.18096) ·
[RAG: Architectures, Enhancements, and Robustness Frontiers](https://arxiv.org/html/2506.00054v1) ·
[Diagnosing Search Behavior and Failure Modes in Long-Horizon Search Agents](https://arxiv.org/html/2608.01913)
