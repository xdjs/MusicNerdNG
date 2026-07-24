# Broken bios that are NOT confirmed AI-generated — needs manual review

**Created:** 2026-07-24 (during the bio voice redesign)
**Status:** untouched — left for manual review, deliberately NOT regenerated.

## Context

The bio voice redesign regenerated **only the 36 bios with a verifiable AI signature**
(citation links, leaked prompt scaffolding, or an AI refusal). See
`docs/superpowers/specs/2026-07-24-bio-voice-design.md`.

The rows below are also broken, but they carry **no AI signature** — their origin can't
be confirmed as AI-generated, so they were intentionally left alone to avoid overwriting
anything a human may have entered. None of these were modified by the backfill.

## Broken / empty bios (origin unknown — do NOT bulk-regenerate)

| Artist | Artist ID | Current bio | Spotify? | Suggested action |
|---|---|---|---|---|
| Juicy BAE | `4c2f82af-7fec-45e8-92e3-438b31d69b15` | *(empty)* | yes | Regenerate individually, or leave for the artist to fill. |
| Robert Farrugia | `169922f5-4933-475a-8ce1-0470bf6d430b` | `a` | yes | Regenerate individually. |
| hkmori | `d5685bb2-85ce-48b1-947f-f6e5538a72df` | `i` | yes | Regenerate individually. |
| punisher.eth | `3ce844f0-0926-401b-9de5-65aaed5a71a0` | `h` | no | No Spotify ID — grounding may find little; review by hand. |

These single-character / empty bios read like placeholders or data-entry artifacts, not
prose. Each has a real page, so a one-off regeneration through the new pipeline would
likely produce a proper bio — but that decision is deferred (it steps past "only the 36").

## Bad entity — not a music artist (deletion candidate)

| Artist | Artist ID | Current bio | Note |
|---|---|---|---|
| Horizon Forbidden West | `8efbf3a9-5cb9-49f8-9625-739dfcefae1d` | *"The last character of the name 'Horizon Forbidden West' is 't'."* | This is a **video game**, not an artist. The bio is an AI scaffolding leak. Regenerating would just write a factual bio about the game. Should be **deleted** from `artists`, not bio-fixed. |

## Signature-less AI-cringe bios (broader class — cannot be safely auto-detected)

Some bios are AI-generated in the *old* cringe voice but have no citation/scaffolding
signature, so they're indistinguishable from human-written bios by content matching.
Example:

- **Yoonha Verse** (`d1f0f5d6-b9d9-4107-b28e-01cdd80c9aaa`) — *"…the sound of deep-web
  discovery… twenty-seven transmissions dropped into the void… The 'Verse' in the name
  isn't a gimmick—it's a promise of a complete, self-contained reality."*

There are likely many of these across the ~253 total bios. They cannot be bulk-detected
without risking overwriting genuinely artist-written bios (the same reason we did not
regenerate all 253). They will be corrected organically as artists are regenerated on
demand under the new voice. A durable fix would be a **bio provenance flag**
(AI-generated vs artist-edited) — already listed as a follow-up in the spec.
