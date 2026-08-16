# "About" — verified-grounding, always-original design

**Date:** 2026-08-16
**Status:** Design approved (validated with a live spike) — proceeding to implementation plan.
**Driving bug:** Black Dave MK2's AI bio conflated him with a different, more famous "Black Dave" (Bronx rapper: *Stay Black*, *Black Bart*, Bodega Bamz/Smoke DZA/RiFF RAFF collabs). Only the web3 aspect was actually him. Prod artist `96bc3fc9-d2e5-48b9-a022-fe7a6414b1cb`.

## Goal
Make the profile "About" (currently "Artist Summary") **accurate**, especially for **unclaimed** artists, by grounding on **verified primary sources** and generating **conservatively** — instead of confidently generating from an open-web name search. Always Music Nerd's **own original text** (never copied); degrade gracefully to a claim-nudge empty-state when nothing can be verified.

## Two failure modes (both reproduced, both mitigated in the spike)
| Mode | Example | Root cause | Mitigation (validated) |
|---|---|---|---|
| **Wrong entity** | Black Dave MK2 → Bronx rapper's discography | Grounding does a **name search**; a famous namesake outranks a thin-presence artist | Anchor grounding on the artist's **verified pages** (Spotify + linked socials), resolved by ID — never by name |
| **Right entity, fabricated relationship** | Pete Rango "collaborated with DJ Jazzy Jeff / A$AP Ferg" (really: live sound / stage management) | Model **upgrades a real association into a musical collaboration**; the true nuance isn't documented online | **Relationship-precision** rule: association ≠ collaboration; omit the relationship unless its exact nature is documented |

## Current sourcing (what we're changing)
`src/server/utils/queries/artistBioQuery.ts`: Gemini **Pro** + Google Search grounding **always on**, seeded with the artist name, a **bare** `Spotify ID:` string, socials, optional anchors (only if stored), thin platform stats, and approved vault sources (claimed only). For an unclaimed artist with no anchors/vault, facts come from **name-based open-web search** → the failure modes above.

## Validation spike (results that drove this design)
- **Verified-ID resolution is conflation-safe.** Spotify ID → Wikidata `P1902` → Wikipedia returns the **right** article or nothing — never the wrong one. A naive name search would have picked "Roddy Radiation" for Black Dave MK2, "Charles Fleischer" for Pete Rango, an album for Daft Punk/Snoop Dogg.
- **Wikipedia coverage is thin for our population.** Known artists 6/6; underground 1/7. So encyclopedic sources help famous artists only — most Abouts rely on the artist's own verified footprint (Spotify/socials) as grounding.
- **Constrained generation is accurate even for the hard cases.** With grounding ON but hard-constrained (identity anchoring + disambiguation + relationship-precision + conservatism + "write in your own words"), the generator produced a **correct** About for **both** Pete Rango *and* Black Dave MK2 — user-confirmed. The Bronx conflation and the fabricated collab were both eliminated.

## Design

### 1. Rename the section to "About"
- "Artist Summary" → **"About"** — honest and neutral; it's **always Music Nerd's own synthesis**, never someone else's words. UI: `BlurbSection` / `VaultSection` header + labels.
- **No separate artist-authored "Bio" field for now** (non-goal). Claimed artists still edit the About and add vault sources (existing edit mode); those remain the highest-priority input.

### 2. One constrained generator — always original text, degrades gracefully
There is **no verbatim tier.** A single generation path, in priority order of grounding:
1. **Artist-provided (claimed) content wins.** If the artist has edited the About, that IS the About (their own words) — never overwrite it by regeneration. Approved vault sources are top-priority grounding.
2. **Best available verified grounding:**
   - Known artists → **Wikipedia via verified ID** (Spotify → Wikidata `P1902` → Wikipedia) as premium grounding — *read for facts, not copied.*
   - Underground → the artist's **verified footprint** (resolvable `open.spotify.com/artist/<id>` URL + linked socials) as the anchor.
3. **Conservative when thin** → 1–3 honest sentences, omit rather than guess.
4. **Empty-state** → when nothing can be verified, show the claim-nudge copy below. Never emit a fabricated About.

### 3. Generator rules (validated — the core of the fix)
- **Identity anchoring:** "The VERIFIED PAGES below ARE this artist. Use only facts consistent with them."
- **Same-name disambiguation:** "Other artists may share this name — ignore them entirely. When unsure an entity is this artist, omit."
- **Relationship precision:** "Do NOT say 'collaborated with / worked with / produced / featured / part of' unless the exact nature is documented. Association ≠ collaboration. Omit if unsure."
- **Conservatism:** "Fewer verifiable facts beat impressive-sounding ones. Verify little → 1–3 sentences; almost nothing → one neutral sentence."
- **Originality (copyright safety):** "Write in your own words. Never copy sentences from any source." (We only ever use *facts*, never others' *expression*.)
- **Brand:** use **"Music Nerd"** (two words) — currently "MusicNerd" in the prompt.
- Grounding stays **ON** (it surfaced the correct facts) but is bound by the rules above.
- *(Enhancement, deferred — blocked on Spotify creds)* inject the artist's **real release/top-track names** as ground truth.

### 4. Empty-state copy (chosen: option A, respelled)
> We couldn't find enough verified information about **{name}** yet — and Music Nerd won't guess. **Are you the artist?** Claim your profile and add a few sources, and your About will fill in within seconds.

### 5. Copyright stance (simplified — the reason there's no verbatim tier)
- **We never reproduce source text verbatim.** Copyright protects *expression*, not *facts*; the generator uses facts and writes original prose, so there's no reproduction and **no attribution/share-alike obligation.**
- Optional, for **trust/transparency only** (not legally required): a light **"Sources: …"** credit derived from Gemini's grounding metadata.

### 6. Preserve artist-authored Abouts
Regeneration must **not clobber** an About the artist authored/edited. Add/confirm a flag distinguishing artist-authored vs. generated (e.g., `artists.about_source` = `artist` | `generated`), and skip regeneration when `artist`. (New column on `artists`; per CLAUDE.md confirm `mnweb` RLS — `artists` already has working policies.)

## The durable accuracy path (product framing)
Constrained grounding cuts conflation dramatically (validated) but can't be 100% for thin-presence, name-colliding, unclaimed artists — the "collaborated vs. live sound" nuance exists nowhere online. The guaranteed-accurate path is **claim + vault**: the artist supplies what only they know. Treat the generated About as a good-faith best effort; the empty-state + nudge convert toward claiming.

## Non-goals (for now)
- A separate artist-authored "Bio" field/concept.
- **Any** verbatim reproduction (dropped — always paraphrase).
- Post-draft **fact-check pass** (cross-check named releases/collabs vs. the real catalog, strip uncorroborated) — worthwhile opt-in follow-on.
- Real-catalog (Spotify release-name) injection — blocked on invalid Spotify creds.

## Open questions / decisions
1. **Spotify creds:** `.env.local`'s `NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_*` are rejected (`invalid_client`); the real-catalog enhancement + current platform-stats fetch depend on valid creds (confirm prod's).
2. **"Sources" credit:** ship the transparency credit now, or defer? (Nice-to-have.)
3. **Regenerate scope after ship:** Black Dave MK2 + unclaimed/thin artists, or broader?

## Testing / verification
- Prompt approach validated live against known + underground artists (this spike). Continue: **regenerate and read several times** (nondeterministic) before trusting.
- **Never clobber prod Abouts while testing** — `generateArtistBio` writes to `artists.bio`; test against Dev or in isolation (no DB write).

## Rollout
1. Ship generator hardening (identity anchoring + disambiguation + relationship-precision + originality + conservatism) + Wikipedia-via-ID grounding + "About" rename + empty-state + artist-authored preservation.
2. Regenerate affected unclaimed/thin-presence Abouts (Black Dave MK2 first), reading before saving.
3. (Follow-on) "Sources" credit, fact-check pass, real-catalog injection (once Spotify creds confirmed), claim-nudge UI polish.
