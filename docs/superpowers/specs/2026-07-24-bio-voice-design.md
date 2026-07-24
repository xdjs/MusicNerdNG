# Artist Bio Voice Redesign

**Date:** 2026-07-24
**Status:** Approved (design), pending spec review
**Area:** `src/server/utils/queries/artistBioQuery.ts`, `src/app/artist/[id]/_components/BlurbSection.tsx`, one backfill script

## Problem

AI-generated "Artist Summary" bios read as cringe LLM prose, not bios. The failure modes, from the Alissa White-Gluz example:

1. **Nameless.** The paragraph never states the artist's name; it opens on a bare pronoun ("They've been Arch Enemy's frontperson…"). This is a direct backfire of the current prompt rule *"Never open with '[Name] is a…'"* — the model avoids the name so hard it never introduces the artist, and defaults to "they" for everyone.
2. **Fact + hollow significance-tag.** Every sentence states a fact and bolts on an empty interpretive clause: "…appear on *Ruling Queen*, **showing their ongoing cross-genre draw**." Not a take — the model narrating that it told you a fact.
3. **Sloppiness the voice rules missed.** "an advocacy **thread** that **threads** through"; The Agonist mentioned twice.
4. **No real point of view.** The prompt begs for "obsessive record-store nerd" energy and "a take on why this work matters"; the model produces a chronological credit-dump with filler instead.

Root cause: the current `musicNerdVoice` prompt asks the model to *perform* personality it can't deliver, which produces mannered filler. The user wants the opposite: stop performing, state what is true, cleanly.

Separately, two adjacent issues surfaced during investigation and are folded into this work at the user's request:
- **39 existing bios** in production are unmistakably AI-generated and broken (verified count; an initial estimate of 34 undercounted "I'm sorry…" AI refusals). 28 carry legacy markdown citations (25 with a literal `utm_source=openai`); the rest are pure prompt-scaffolding leaks with no link (e.g. `"Checklist: (1) Identify the artist…"`) or explicit AI refusals (`"I'm sorry, but I couldn't find much information on the artist with the Spotify ID…"`). None could be artist-written. The backfill script prints the exact matched set on a dry run before any write.
- **`renderMarkdown` in `BlurbSection.tsx` is a stored-XSS vector**: it applies bold/italic regex and injects the result via `dangerouslySetInnerHTML` **without escaping HTML**, so any `<script>`/`<img onerror>` in a bio executes for every visitor. Artist editors can PUT arbitrary bio text.

### Provenance note (why we do NOT regenerate all bios)

There is **no provenance field** distinguishing AI-written from artist-written bios: `artists.bio` is a lone text column, and `artist_bio_versions` tracks only `bio_text / is_pinned / created_at` — no author or `is_ai` flag. Some of the ~253 existing bios may be artist-authored. Therefore the backfill is **strictly limited to content-verified AI junk** (the 34 above). The AI-signature match *is* the safety mechanism — a human bio will not contain citation markdown or leaked prompt scaffolding. Bulk-regenerating all 253 is explicitly rejected: it would risk clobbering human work.

Adding a provenance flag going forward (mark bios AI vs artist-edited) is a sensible **follow-up** so future backfills never rely on content-sniffing.

## Goals

- Bios read like a clean, factual encyclopedia entry: name-anchored, third person, no editorializing.
- Facts are verifiable: grounding on by default, anchored to the identifiers MusicNerd already stores.
- Correct-or-neutral pronouns, never a guessed gendered pronoun.
- The 34 content-verified broken AI bios regenerated to the new standard (no artist-written bio touched).
- Close the `dangerouslySetInnerHTML` XSS hole.

## Non-goals (follow-ups)

- Dedicated MusicBrainz / Discogs / Wikipedia **API fetch** for structured facts (higher fidelity, separate project).
- Regenerating **all** ~253 existing bios (scope is the 34 content-verified AI ones; some of the rest may be artist-written — see Provenance note).
- Applying the new voice to `askArtist` Q&A (it uses the bio as context; can follow later).
- Replacing Gemini Google Search grounding with a dedicated search provider (Exa/Tavily/etc. — none currently wired).

## Decisions (locked with user)

| Dimension | Decision |
|---|---|
| **Voice** | Lean & factual — encyclopedia entry, not review/press release. No hooks, no significance-tags, no editorializing. |
| **Length** | One paragraph, **up to ~100 words**. Shorter when facts are thin; never pad to hit a count. |
| **Pronouns** | Use she/he/they only when the artist is **clearly documented** to use them in sources; fall back to **they/them** when unclear. Never guess a gendered pronoun. |
| **Fact source** | Google Search grounding **always on** + pass the identifiers the DB already holds (Wikipedia, MusicBrainz, Discogs, Wikidata) as authoritative anchors + platform stats + vault sources. No new external API integrations. |
| **Dirty bios** | **Regenerate** the 34 content-verified AI bios through the new pipeline (not just strip citations — that would leave the old voice). Never touch bios without an AI signature. |

## Implementation

### Part A — Prompt voice + anchors + grounding (`artistBioQuery.ts`)

**A1. Replace the `musicNerdVoice` system prompt** with the factual voice:

> You write clean, factual artist bios for MusicNerd. Think well-written encyclopedia entry, not a review or press release. Tell the reader who this artist is and what they're known for — accurately, without embellishment.
>
> Write ONE paragraph, up to ~100 words. Shorter is better than padded: if verified facts are thin, write two or three honest sentences.
>
> Structure:
> - Open with the name and what they are: "[Name] is a [role/genre] from [place]." This is the one place a plain identity sentence is correct — lead with it.
> - Follow with the most significant verifiable facts: bands, notable releases, collaborators, milestones, dates, well-documented activity outside music.
> - Stop when the facts run out. No closing "significance" flourish.
>
> Rules:
> - Third person. Anchor on the name; use pronouns sparingly.
> - Pronouns: use she/he/they only as the artist is clearly documented to use them in your sources. If unclear, use they/them. Never guess a gendered pronoun.
> - State only what your sources support. Never invent bands, releases, collaborators, places, or dates. Unsure → leave it out.
> - No editorializing. Don't tell the reader why the work "matters," don't say the artist is "showing"/"proving" something, don't append interpretive clauses to facts. Report the fact and stop.
> - Banned hype: "emerging," "rising," "boundary-pushing," "eclectic," "versatile," "undeniable," "sonic," "soundscape," "artist to watch," "cross-genre draw," "carving out." Banned résumé-speak: "leveraged," "spearheaded," "secured," "integrated."
> - Plain, direct sentences.

The vault-context variant keeps its "primary source" framing but adopts the same factual voice.

**A2. Add authoritative anchors to `promptParts`**, formatted as real URLs, labeled so grounding disambiguates the correct entity:
- Wikipedia → `https://en.wikipedia.org/wiki/{artist.wikipedia}` — **fixes existing bug**: line 49 currently passes the bare slug (`Wikipedia: Anberlin`), which is useless.
- MusicBrainz → `https://musicbrainz.org/artist/{artist.musicbrainz}` (stored as MBID; ~54% of catalog)
- Discogs → `https://www.discogs.com/artist/{artist.discogs}` (stored as numeric id)
- Wikidata → `https://www.wikidata.org/wiki/{artist.wikidata}`

Group them under a clear label, e.g. `Authoritative identity anchors (use these to confirm exactly which artist this is; prefer facts they support):`.

**A3. Grounding always on.** Change `useGrounding` from `hasVaultContext && vaultUrls.length > 0` to always pass `tools: [{ googleSearch: {} }]`. Latency is covered by the existing 45s race and `maxDuration = 60`; bios are cached, so users don't wait on generation.

**A4. Keep `sanitizeBioText`** (already shipped) on the generated output — safety net for any citation URLs grounding emits.

### Part B — XSS hardening (`BlurbSection.tsx`)

Harden `renderMarkdown` to **escape HTML before** applying the bold/italic regex, so the injected HTML contains only the `<strong>`/`<em>` tags we control:

```
function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}
```

Escaping `<`, `>`, `&` is sufficient for element-content context (we are not writing into an attribute). Asterisks are untouched, so `**bold**` / `*italic*` still work. This makes stored-XSS via bio text impossible without adding a dependency.

### Part C — Backfill the 34 broken AI bios

One-time script (run locally against prod, after Parts A/B are verified and with explicit user go-ahead):
- **Selection (AI-signature only):** an artist qualifies if its `bio` matches any of:
  - `bio ~ '\]\(https?://'` (markdown citation link) — 28 rows
  - `bio ILIKE '%utm_source=openai%'` — subset of the above
  - `bio ILIKE '%Identify the artist%'` OR `bio ILIKE '%Retrieve verified information%'` OR `bio ILIKE '%Checklist:%'` (prompt-scaffolding leak)
  - `bio ILIKE '%I could not find%'` OR `bio ILIKE '%I'm sorry%'` (AI refusal)
  - Total ≈ 34. The script prints the exact matched set for confirmation before writing anything.
- For each, call the new `generateArtistBio()` (regenerates in the new voice + grounding, writes back through the existing code path).
- Cost/impact: ~34 grounded Gemini calls, a few minutes, prod writes. Serial with a small delay to respect rate limits. Log before/after per artist.
- **Never selects a bio without an AI signature** — no risk to artist-written bios.
- This is a **prod DB write** — gated on user confirmation at run time, not run silently.

## Testing

Unit tests mock Gemini, so they verify **wiring**, not writing quality:
- `renderMarkdown` (TDD): `<script>alert(1)</script>` renders escaped; `**bold**`/`*italic*` still produce `<strong>`/`<em>`.
- `generateArtistBio`: grounding tools present on **every** call (not just with vault sources); anchor URLs (musicbrainz/wikipedia/discogs/wikidata) appear in the prompt when the artist has those ids; Wikipedia is passed as a full URL, not a slug; `sanitizeBioText` still applied to output; thin-data artist still yields a short bio.

**Quality gate is manual eval:** regenerate 3 real artists locally through the new pipeline and eyeball before shipping — Alissa White-Gluz (rich, gendered), Cocteau Twins (band), and a thin-data artist (e.g. Daegho). Confirm: name-anchored, factual, no filler, correct/neutral pronouns, no invented facts.

## Rollout / sequencing

1. Part B (XSS) — independent, ship-safe on its own.
2. Part A (voice + anchors + grounding) — with unit tests.
3. Manual eval of 3 regenerated bios; iterate on prompt wording if needed.
4. Merge to `staging`.
5. Part C (backfill 34) — after A/B verified, with user go-ahead, run against prod.

## Open items

- **Model choice.** Staying on `gemini-2.5-pro`. If factual output still drifts, revisit.
- **Pronoun accuracy** depends on grounding surfacing clear sources; the they/them fallback bounds the downside.
- Widening backfill beyond the 34 AI-signature bios is deferred; it requires a provenance flag (below) to stay safe.
- **Follow-up:** add a bio provenance flag (AI-generated vs artist-edited) so future backfills never rely on content-sniffing.
