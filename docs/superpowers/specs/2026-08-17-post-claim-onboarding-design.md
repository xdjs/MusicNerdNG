# Post-Claim Conversational Onboarding — Design Spec

**Date:** 2026-08-17
**Branch:** `pete/recoup-onboarding-exploration`
**Status:** Approved design (brainstorm + advisor review complete)

## 1. Context & problem

Today, after an admin approves an artist's profile claim, the artist gets no notification and no guided experience — just a "Claimed" badge and a raw VaultManager. The claim captures no evidence, the About pipeline depends on vault sources the artist never curates, and nothing the artist uniquely knows (their story, voice, what they're working on) ever enters the system.

This design adds a chat-driven post-claim onboarding, inspired by Recoup's (github.com/recoupable) artist onboarding. Research findings that shaped it:

- Recoup's chat onboarding *feels* agentic but is a **forced tool chain** — the server owns the step sequence; the model only narrates and asks.
- Recoup's v2 replaced stored wizard state with **derived state**: the current step is the first unmet checkpoint, recomputed from real data. Resume is free.
- Their artist knowledge file is injected into every future AI interaction — the doc is **persistent context**, not a one-shot bio.
- Their hardest-won lesson: **no placeholders, ever** — real data or omit the section.
- They never built an artist *interview*; their doc is 100% scraped. Asking the artist directly is our differentiator.

**Licensing constraint:** Recoup's key repos are AGPL/dual-licensed or unlicensed. Nothing is copied — patterns only, implemented fresh on our stack.

## 2. Goals

At the end of onboarding an artist has: platform links confirmed by them, vault sources curated, a 3-question interview captured, an About published, and a durable **artist doc** (markdown knowledgebase) feeding `AskAboutArtist`, bio generation, and fun facts.

North star: mine **stories and connections** from the artist — one tellable specific beats three generic facts.

### Non-goals (v1)

- Claim *verification* is unchanged (Instagram DM + admin approval).
- No Apify/social scraping (designed-for seam; phase 2).
- No chat transcript persistence (conversation is ephemeral; state lives in tables).
- No doc versioning (regeneration overwrites).
- No `storage_url`/Arweave column (one-line migration when Arweave lands).
- No progressive-question-bank surfacing UI (schema supports it; fast-follow).
- No artist-to-artist connection *graph* (doc keeps `## Connections` prose; edges are a fast-follow).
- No new rate-limit tier (default 60/min tier covers the route).
- No Meta/Google OAuth.

## 3. User journey

1. **Admin approves claim** (existing `approveClaimAction`). Existing side effects stay (background `searchAndPopulateVault`, Discord). **New:** send the claimant an approval email — "Your Music Nerd profile is approved 🎉" — with one CTA linking to `/artist/[id]`. If `users.email` is NULL (legacy wallet users), skip the send and log; the banner is the guaranteed channel.
2. **Artist visits their artist page** (from email or organically). If the viewer is the approved claimant for *this* artist and onboarding is incomplete, the page opens the onboarding chat as a full-screen takeover. "Skip for now" exits to the normal page with a persistent "Finish setting up →" banner (nudge copy: one next step, gaps framed as the next win, never shamed).
3. **The chat** runs the forced chain below, resuming at the first unconfirmed step. "Skip for now" is session-scoped (`sessionStorage`): within that browser session only the banner shows; a later visit opens the chat takeover again.
4. **Finish:** About published, artist doc saved, chat closes with a success moment. Banner never shows again.

## 4. Architecture decisions

- **Chat engine: plain `@google/genai` (existing Gemini key) + a thin SSE layer. No Vercel AI SDK.** The server drives all deterministic work in code (search, link writes, discovery, upserts); Gemini supplies narration, interview conversation, and About/doc prose. Progress chips ("⚙ Searching…") are server-emitted SSE events, not model tool calls. The model has zero tool authority.
- **One POST per chat turn.** Each request streams one turn's SSE and closes. `export const maxDuration = 60` plus an in-handler deadline (the `artistBio` pattern, `src/app/api/artistBio/[id]/route.ts`). A turn that hits the deadline leaves its checkpoint unconfirmed — the next turn resumes it. No long-lived connection spanning the conversation (Vercel kills it).
- **Email: Resend.** New optional env var `RESEND_API_KEY` in `src/env.ts` (default `""`, like `GEMINI_API_KEY`). Helper `src/server/utils/email.ts`; plain-HTML template function (no react-email dependency). Ops prerequisite: verify the sending domain in Resend DNS.
- **Enrichment v1 = free APIs only:** live Spotify follower counts/images and Deezer fan counts on profile cards; other platforms shown without counts. Phase 2 (Apify) lights up IG/TikTok cards and post ingestion without Meta app review.
- **Discovery reuse:** the vault step *reads* the pending sources that approval-time `searchAndPopulateVault` already inserted. It re-runs discovery only if the vault is empty, within the turn deadline; if discovery can't finish in-turn, the chat says so and the step resumes next turn.

## 5. Data model

Three new tables. **Every migration ships the four `mnweb` RLS policies with real expressions** (`FOR SELECT/UPDATE/DELETE ... USING (true)`, `FOR INSERT ... WITH CHECK (true)`, `FOR UPDATE ... USING (true) WITH CHECK (true)`) — matching `ugcresearch`; empty policies silently killed claiming on prod (see `drizzle/0010`, `docs/db-fixes/2026-07-27-prod-rls-fix.md`).

```sql
-- The knowledgebase artifact (the .md equivalent)
artist_docs (
  id         uuid PK DEFAULT uuid_generate_v4(),
  artist_id  uuid NOT NULL UNIQUE REFERENCES artists(id) ON DELETE CASCADE,
  content    text NOT NULL,                 -- markdown, single source of truth
  created_at / updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
)
-- writes: ON CONFLICT (artist_id) DO UPDATE (two-tab safety)

-- What the artist actually said (raw, never lost to regeneration)
artist_interview_answers (
  id           uuid PK DEFAULT uuid_generate_v4(),
  artist_id    uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  question_key text NOT NULL,   -- 'sound_in_own_words' | 'offline_fact' | 'working_on_now' | future bank keys
  question     text NOT NULL,   -- as actually asked, for audit
  answer       text,            -- NULL = explicitly skipped (counts as asked)
  source       text NOT NULL,   -- 'onboarding' | 'followup'
  created_at   timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  UNIQUE (artist_id, question_key)
)
-- writes: ON CONFLICT (artist_id, question_key) DO UPDATE

-- Step confirmations: "the artist saw and confirmed it", not "data exists"
artist_onboarding_steps (
  id           uuid PK DEFAULT uuid_generate_v4(),
  artist_id    uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  step         text NOT NULL,   -- 'profiles' | 'vault' | 'interview' | 'publish'
  confirmed_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  UNIQUE (artist_id, step)
)
```

**Why confirmations instead of data-existence checks:** nearly every artist already has platform links before claiming (UGC, ID-mapping agents, Spotify-based creation), and admins can pre-approve vault sources — existence checks would silently skip the steps for basically everyone. Confirmation rows record the artist's act. Skips are confirmations too: a sourceless artist confirms an empty vault and moves on (never stuck).

**Derived state** (pure functions in `src/server/utils/queries/onboardingQueries.ts`):

- Current step = first of `profiles → vault → interview → publish` lacking a confirmation row for this artist.
- `onboardingComplete` = the `'publish'` confirmation row exists.
- Always derive from the `(userId, artistId)` pair via `getApprovedClaimForArtistByUserId` / `canEditArtist` — never from single-claim `getApprovedClaimByUserId` (`findFirst`; breaks for multi-claim users).

**Claim revocation (required change):** `revokeApprovedClaim` (`src/server/utils/queries/dashboardQueries.ts`) additionally deletes this artist's `artist_docs`, `artist_interview_answers`, and `artist_onboarding_steps` rows **in the same transaction** — same invariant as the existing vault-source wipe: a re-claimer must not inherit (or be silently skipped past onboarding by) the previous owner's content. If the transaction deleted a doc row (i.e. the revoked owner had published), also clear `artists.bio` — whether doc-generated or later hand-edited, it is the revoked owner's content.

## 6. The chat chain (forced steps)

Every step ends with an explicit artist action ("Looks good", "Keep these", answering/skipping the last question, "Publish") — and that action is what writes the step's confirmation row. No confirmation is ever written by data merely existing.

**Step `profiles` — "Is this you?"**
Show the artist's current links plus auto-found candidates (existing Deezer/Spotify providers, reverse lookups `findArtistByIG`/`findArtistBySpotifyID`/`findArtistByDeezerID`, `artist_id_mappings`) as accepted-by-default cards with live Spotify/Deezer numbers where available. Removing/adding is the only work. Confirmed additions are written via `artistLinkService.setArtistLink` (dedup: a link that already exists is treated as confirmed, no duplicate write). Pasted URLs go through the `extractArtistId`/urlmap path; unknown platforms or extraction throws are caught and answered politely in-chat, never surfaced as errors.

**Step `vault` — curate sources.**
Present pending vault sources (from approval-time discovery) as keep/skip cards; keep/skip maps to the existing approve/reject path (`updateSourceStatus`). Empty vault → run discovery within deadline, or degrade to "we didn't find much — paste a link?" Empty-confirm is valid.

**Step `interview` — three questions, ~90 seconds, all skippable.**
`sound_in_own_words` ("How would you describe your sound, in your own words?"), `offline_fact` ("What's something fans should know that isn't written anywhere online?"), `working_on_now` ("What are you working on right now?"). Answers upsert with `source='onboarding'`; skip writes `answer = NULL`. Skipped questions return to the future follow-up bank. On resume, ask the first `question_key` lacking a row — answered or skipped questions are never re-asked.

**Step `publish` — the payoff.**
Two generations, in order: `artistDocService.synthesizeDoc(artistId)` gathers links + ID mappings + approved vault sources + interview answers → Gemini synthesizes the **doc** (the knowledgebase artifact); then the public **About** is generated *from the doc* and **streams live in the chat**. Turns are stateless, so the generation turn streams the doc and About to the client, and the Publish action POSTs both back; the server validates (bio ≤ `MAX_BIO_LENGTH`, doc ≤ a fixed cap, e.g. 20,000 chars) before writing. Claimant-supplied content is already the trust model for bio writes (`saveCurrentBio`), so this adds no new surface. On the artist's explicit "Publish": upsert `artist_docs`, save the bio via the existing `saveBioVersion` path and set `artists.bio`, write the `publish` confirmation. **The doc→bio write happens only at this explicit moment; later doc regenerations never implicitly touch `artists.bio`** (preserves the existing invariant that link changes don't clobber bios, `src/server/utils/artistLinkService.ts`).

## 7. The artist doc

Markdown with a fixed section vocabulary: `## Overview`, `## Sound`, `## Story hooks`, `## Currently`, `## Influences & comparables`, `## Connections`, `## Aesthetic & voice`, `## Discography highlights`. **Anti-placeholder rule is hard:** a section with no real material does not exist. Absent sections *are* the future question bank — gap detection is parsing headers from `content`, no parallel bookkeeping.

**Synthesis mandate: mine, don't summarize.** Prefer one specific, tellable detail over three generic facts; name real people and places; extract recurring themes; quote interview answers verbatim, never paraphrase them. Target ≤ 800 words.

**Consumers:** `askArtist` context, bio generation, fun facts (drawing from `## Story hooks`). Injection is hard-capped at 8,000 characters of doc content so consumers' existing time/size budgets hold (askArtist runs a 20s race with 2,000-char source truncation today).

## 8. Components

```
approveClaimAction ─┬─ (existing) searchAndPopulateVault, Discord
                    └─ NEW sendClaimApprovedEmail (null-email guard, non-blocking)

artist page (server) — getOnboardingState(artistId) runs ONLY when isClaimedByUser
  └─ incomplete → <OnboardingChat> full-screen | skipped → "Finish setting up →" banner

POST /api/onboarding/[artistId]/chat   (SSE, one turn per request, maxDuration 60)
  auth: canEditArtist(userId, artistId); default middleware rate-limit tier
  step engine → handler for first unconfirmed step (all handlers idempotent upserts)

src/server/utils/artistDocService.ts   — doc synthesis + injection helper (with cap)
src/server/utils/email.ts              — Resend wrapper + approval template
src/server/utils/queries/onboardingQueries.ts — derivation + confirmations CRUD
src/app/artist/[id]/_components/onboarding/   — chat surface, useOnboardingChat (SSE),
  cards: profile (accepted-by-default), source (keep/skip), streaming About
```

Client note: `useOnboardingChat` must handle a JSON 429 body on a route it otherwise expects to stream SSE. The server only reports onboarding state; the takeover-vs-banner branch is decided client-side, since the skip flag lives in `sessionStorage` and is invisible to the server component.

## 9. Error handling

Principle: **every failure leaves a resumable state, never a broken one.**

- Turn deadline hit → checkpoint stays unconfirmed; next turn resumes. SSE disconnect → same.
- Gemini failure → apologize in-stream, retry once, else leave step unconfirmed.
- Email send failure → log only; approval never blocks on email.
- Discovery empty/failing → degrade to paste-a-link; empty-confirm allowed.
- Doc synthesis failure → onboarding stays incomplete; retry affordance in chat.
- Two tabs → `ON CONFLICT` upserts everywhere; concurrent synthesis = one wasted Gemini call, last write wins (accepted; no locking).

**Security:** claimant-only route; model has no tool authority (server code does all writes), so prompt injection from scraped source text has the same bounded blast radius as existing `askArtist` — content quality, not actions.

## 10. Testing

- Checkpoint derivation: pure functions → direct unit tests (this is where the logic lives).
- API route tests per house template (`jest.resetModules` + dynamic imports, mocked queries, `params` as Promise).
- Resend, Gemini, Discord mocked. Middleware untouched (no new tier).
- **Regression-critical:** revocation transaction test asserting docs + answers + step confirmations are wiped.
- Full gate before push: `npm run type-check && npm run lint && npm run test && npm run build`.

## 11. Phases

**V1 (this spec):** everything above.

**Fast-follows (explicitly out of v1, seams ready):**
1. **Apify social ingestion** — chosen over Meta Graph API (no app review; covers IG/TikTok/Threads/YouTube via one vendor). Tables: `artist_social_profiles` (platform, handle, avatar_url, bio, follower_count, fetched_at), `artist_social_posts` (caption, posted_at, url, engagement jsonb). Recoup's batch-scrape → webhook → upsert design is the blueprint. Posts feed theme extraction → `## Story hooks` / `## Connections` on next synthesis; captions are the voice signal.
2. **Progressive question bank** — surface one unanswered question per visit (`source='followup'`), keyed off missing doc sections.
3. **Connection graph** — resolve `## Connections` names against the artists table into real edges.
4. **Arweave** — add a `storage_url` pointer column; docs become `{name, url, type}` pointers (Recoup's model).

**Related but independent (memory-noted, not this branch):** two-step Gemini structuring for `searchAndPopulateVault` (grounded prose call → ungrounded structuring call) to replace the flaky forced-JSON retry loop.
