# "About" Verified-Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the artist "About" accurate — anchor generation on verified IDs, hard-constrain it against same-name conflation and relationship-inflation, always write original text, and degrade to a claim-nudge empty-state.

**Architecture:** One constrained generator in `artistBioQuery.ts`. A new `verifiedGrounding.ts` resolves premium encyclopedic grounding by ID (Spotify → Wikidata `P1902` → Wikipedia extract). UI renames "Artist Summary" → "About" and swaps the empty-state copy. No verbatim reproduction (facts only). No schema change in this plan.

**Tech Stack:** Next.js 15, TypeScript, Gemini (`@google/genai`, Pro + Google Search grounding), Jest.

## Global Constraints
- Brand is **"Music Nerd"** (two words) in all user-facing strings + prompts.
- **Never reproduce source text verbatim** — use facts, write original prose.
- Grounding stays **ON** but bound by the generator rules.
- **Never clobber prod Abouts while testing** — test against Dev / in isolation (no DB write).
- Match each file's existing indentation.

## File Structure
- **Create** `src/server/utils/verifiedGrounding.ts` — `resolveVerifiedGrounding(spotifyId)`; Wikidata+Wikipedia lookup, returns `{source,url,extract}|null`.
- **Create** `src/server/utils/__tests__/verifiedGrounding.test.ts`.
- **Modify** `src/server/utils/queries/artistBioQuery.ts` — Spotify URL anchor, guardrail system prompt, inject grounding, "Music Nerd".
- **Modify** `src/server/utils/queries/__tests__/artistBioQuery.test.ts` — assert prompt contract + grounding injection.
- **Modify** `src/app/artist/[id]/page.tsx:145` — header "Artist Summary" → "About".
- **Modify** `src/app/artist/[id]/_components/VaultManager.tsx:239` — "Artist Summary" → "About".
- **Modify** `src/app/api/artistBio/[id]/route.ts` — empty-state copy A + "Music Nerd" + add `spotify` to the has-signal check.

---

### Task 1: `verifiedGrounding.ts` — resolve encyclopedic grounding by verified ID

**Files:**
- Create: `src/server/utils/verifiedGrounding.ts`
- Test: `src/server/utils/__tests__/verifiedGrounding.test.ts`

**Interfaces:**
- Produces: `resolveVerifiedGrounding(spotifyId: string | null): Promise<{ source: "wikipedia"; url: string; extract: string } | null>`
- Consumes: global `fetch` (mocked in tests).

- [ ] **Step 1: Write the failing test**
```typescript
import { resolveVerifiedGrounding } from "../verifiedGrounding";

function mockFetchSequence(responses: Array<{ ok?: boolean; json: any }>) {
  const fn = jest.fn();
  responses.forEach(r => fn.mockResolvedValueOnce({ ok: r.ok ?? true, json: async () => r.json }));
  global.fetch = fn as any;
  return fn;
}

describe("resolveVerifiedGrounding", () => {
  it("returns a Wikipedia extract when Spotify ID resolves via Wikidata P1902", async () => {
    mockFetchSequence([
      { json: { results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q123" }, sitelink: { value: "https://en.wikipedia.org/wiki/Grimes_(musician)" } }] } } },
      { json: { extract: "Claire Elise Boucher, known as Grimes, is a Canadian musician." } },
    ]);
    const r = await resolveVerifiedGrounding("053q0ukIDRgzwTr4vNSwab");
    expect(r).toEqual({ source: "wikipedia", url: "https://en.wikipedia.org/wiki/Grimes_(musician)", extract: expect.stringContaining("Grimes") });
  });

  it("returns null when no Wikidata item is linked to the Spotify ID", async () => {
    mockFetchSequence([{ json: { results: { bindings: [] } } }]);
    expect(await resolveVerifiedGrounding("7cOl6pCLdiRKfC8nnNQ0ax")).toBeNull();
  });

  it("returns null for a null/empty spotifyId without calling fetch", async () => {
    const fn = mockFetchSequence([]);
    expect(await resolveVerifiedGrounding(null)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns null when a Wikidata item exists but has no English Wikipedia article", async () => {
    mockFetchSequence([{ json: { results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q9" } }] } } }]);
    expect(await resolveVerifiedGrounding("abc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `npx jest verifiedGrounding` → FAIL "Cannot find module '../verifiedGrounding'".

- [ ] **Step 3: Implement**
```typescript
// src/server/utils/verifiedGrounding.ts
const UA = "MusicNerd/1.0 (https://musicnerd.xyz)";
const MIN_EXTRACT = 40; // ignore stubs

/**
 * Resolve premium encyclopedic grounding for an artist by VERIFIED ID
 * (Spotify ID → Wikidata property P1902 → English Wikipedia extract). ID-based
 * so it is conflation-safe: returns the right article or null, never a namesake.
 * The extract is used as GROUNDING for original generation — never reproduced verbatim.
 */
export async function resolveVerifiedGrounding(
  spotifyId: string | null
): Promise<{ source: "wikipedia"; url: string; extract: string } | null> {
  if (!spotifyId) return null;
  try {
    const sparql = `SELECT ?item ?sitelink WHERE { ?item wdt:P1902 "${spotifyId}". OPTIONAL { ?sitelink schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } } LIMIT 1`;
    const wdRes = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
    if (!wdRes.ok) return null;
    const wd = await wdRes.json();
    const b = wd?.results?.bindings?.[0];
    const sitelink: string | undefined = b?.sitelink?.value;
    if (!sitelink) return null;
    const title = decodeURIComponent(sitelink.split("/wiki/")[1] ?? "");
    if (!title) return null;
    const wpRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { "User-Agent": UA } });
    if (!wpRes.ok) return null;
    const wp = await wpRes.json();
    const extract: string = (wp?.extract ?? "").trim();
    if (extract.length < MIN_EXTRACT) return null;
    return { source: "wikipedia", url: sitelink, extract };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, confirm pass** — `npx jest verifiedGrounding` → PASS.
- [ ] **Step 5: Commit** — `feat(bio): verified-ID → Wikipedia grounding resolver (conflation-safe)`.

---

### Task 2: Harden the generator (`artistBioQuery.ts`)

**Files:**
- Modify: `src/server/utils/queries/artistBioQuery.ts`
- Test: `src/server/utils/queries/__tests__/artistBioQuery.test.ts`

**Interfaces:**
- Consumes: `resolveVerifiedGrounding` (Task 1).

**Changes:**
1. Replace `Spotify ID: ${artist.spotify}` with a resolvable URL: `` `Spotify (verified identity): https://open.spotify.com/artist/${artist.spotify}` ``.
2. Call `resolveVerifiedGrounding(artist.spotify)`; when non-null, push `` `Verified encyclopedic source (facts only — do NOT copy wording):\n${g.extract}` `` into `promptParts`.
3. Append guardrail block to `musicNerdVoice` (identity anchoring, same-name disambiguation, relationship precision, originality, conservatism).
4. Replace both "MusicNerd" occurrences in the prompt with "Music Nerd".

- [ ] **Step 1: Write failing tests** (add to the existing describe; the file already mocks `getGemini` with `mockGenerateContent`):
```typescript
// add near other jest.mock calls:
const mockGrounding = jest.fn().mockResolvedValue(null);
jest.mock("@/server/utils/verifiedGrounding", () => ({ resolveVerifiedGrounding: (...a) => mockGrounding(...a) }));

it("anchors identity via a resolvable Spotify URL, not a bare ID", async () => {
  const { getArtistById } = await import("@/server/utils/queries/artistQueries");
  (getArtistById as jest.Mock).mockResolvedValue({ id: "a1", name: "Black Dave MK2", spotify: "7cOl6pCLdiRKfC8nnNQ0ax" });
  const { generateArtistBio } = await import("../artistBioQuery");
  await generateArtistBio("a1");
  const call = mockGenerateContent.mock.calls[0][0];
  expect(call.contents).toContain("open.spotify.com/artist/7cOl6pCLdiRKfC8nnNQ0ax");
  expect(call.contents).not.toContain("Spotify ID: 7cOl6pCLdiRKfC8nnNQ0ax");
  expect(call.config.systemInstruction).toMatch(/collaborated with|Association/i); // relationship-precision rule present
  expect(call.config.systemInstruction).toContain("Music Nerd");
  expect(call.config.systemInstruction).not.toContain("MusicNerd");
});

it("injects verified encyclopedic grounding when the resolver finds one", async () => {
  const { getArtistById } = await import("@/server/utils/queries/artistQueries");
  (getArtistById as jest.Mock).mockResolvedValue({ id: "a2", name: "Grimes", spotify: "053q0ukIDRgzwTr4vNSwab" });
  mockGrounding.mockResolvedValueOnce({ source: "wikipedia", url: "https://en.wikipedia.org/wiki/Grimes_(musician)", extract: "Claire Elise Boucher, known as Grimes, is a Canadian musician." });
  const { generateArtistBio } = await import("../artistBioQuery");
  await generateArtistBio("a2");
  expect(mockGenerateContent.mock.calls[0][0].contents).toContain("Canadian musician");
});
```
(Add `mockGrounding.mockResolvedValue(null)` to `beforeEach`.)

- [ ] **Step 2: Run, confirm fail** — `npx jest queries/__tests__/artistBioQuery` → new tests FAIL (bare ID still used, no grounding injection, "MusicNerd" present).

- [ ] **Step 3: Implement the changes** in `artistBioQuery.ts` (import `resolveVerifiedGrounding`; swap the Spotify line; add the grounding fetch + injection near the vault block; append the guardrail block below to `musicNerdVoice`; fix the two "MusicNerd" → "Music Nerd").
```
GUARDRAILS (append to musicNerdVoice):
- IDENTITY: The Spotify page and linked socials provided ARE this artist. Use only facts consistent with them. Other artists may share this name — ignore them; when unsure an entity is this artist, omit it.
- RELATIONSHIP PRECISION: Do not say "collaborated with / worked with / produced / featured / part of" unless the exact nature is documented. Association is not collaboration. Omit if unsure.
- ORIGINALITY: Write in your own words. Never copy sentences from any source.
```

- [ ] **Step 4: Run, confirm pass** — `npx jest queries/__tests__/artistBioQuery` → PASS (incl. existing tests).
- [ ] **Step 5: Commit** — `feat(bio): identity-anchored, disambiguation + relationship-precision generation`.

---

### Task 3: "About" rename + empty-state copy A + signal check

**Files:**
- Modify: `src/app/artist/[id]/page.tsx:145`, `src/app/artist/[id]/_components/VaultManager.tsx:239`, `src/app/api/artistBio/[id]/route.ts`

- [ ] **Step 1:** `page.tsx:145` — `>Artist Summary<` → `>About<`.
- [ ] **Step 2:** `VaultManager.tsx:239` — `<strong>Artist Summary</strong>` → `<strong>About</strong>`.
- [ ] **Step 3:** `artistBio/[id]/route.ts` — replace the `testBio` string (line ~48) with copy A and include `!artist.spotify` in the guard so we still generate when a Spotify anchor exists:
```typescript
if (!forceRegenerate && !artist.bio && !artist.spotify && !artist.youtubechannel && !artist.instagram && !artist.x && !artist.soundcloud) {
  const emptyState = "We couldn't find enough verified information about this artist yet — and Music Nerd won't guess. If this is you, claim your profile and add a few sources, and your About will fill in within seconds.";
  return NextResponse.json({ bio: emptyState }, { headers: CORS_HEADERS });
}
```
- [ ] **Step 4:** Run the artistBio route test suite if present (`npx jest artistBio`) — confirm green; if a test asserts the old string, update it to the new copy.
- [ ] **Step 5: Commit** — `feat(about): rename Summary → About; claim-nudge empty-state; Spotify-anchor signal check`.

---

### Task 4: End-to-end validation (TEST BEFORE FINISH — required gate)

**Not a code change.** A gitignored (`.git/info/exclude`) local script that calls `generateArtistBio` logic against Dev/in isolation — **must NOT write to the DB** (build the prompt + call Gemini, print output; do not run the `db.update`).

- [ ] **Step 1:** Regenerate the About for **Black Dave MK2** (`7cOl6pCLdiRKfC8nnNQ0ax`) and **Pete Rango** (`3DmaZbBPnKSGnxYRpHobss`) with the new pipeline; print output.
- [ ] **Step 2:** Read each **2–3 times** (nondeterministic). Confirm: no Bronx/skateboarder conflation for Black Dave; no fabricated "collaborated with" for Pete Rango; facts consistent with their verified pages.
- [ ] **Step 3:** Run full checks — `npm run type-check && npm run lint && npm test`.
- [ ] **Step 4:** Report results to the user before shipping. Do not mark done until this gate passes.

---

## Deferred (out of scope for this plan — flag to user)
- **Preserve artist-authored Abouts** (spec §6): `artists.about_source` column + skip-regeneration guard. Needs a **schema migration + prod DB-change approval** (per CLAUDE.md/standing rule), so it's a separate, gated task.
- **"Sources" credit** from grounding metadata (trust/transparency).
- **Fact-check pass**; **real-catalog (Spotify release-name) injection** (blocked on invalid Spotify creds).

## Self-Review
- **Spec coverage:** generator hardening (§3) ✓; verified-ID grounding (§2) ✓; "About" rename (§1) ✓; empty-state copy A (§4) ✓; originality/copyright (§5) ✓; "Music Nerd" ✓. Deferred items explicitly listed (§6 preserve-authored, Sources credit, fact-check, real-catalog) with rationale.
- **Placeholders:** none — exact paths/lines, real code, real test assertions.
- **Type consistency:** `resolveVerifiedGrounding` signature identical in Task 1 (definition) and Task 2 (mock + usage).
