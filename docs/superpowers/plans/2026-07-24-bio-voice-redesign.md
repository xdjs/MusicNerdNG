# Bio Voice Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-cringe artist bio voice with a clean, factual, name-anchored one; ground every bio in verifiable sources; close a stored-XSS hole in bio rendering; and regenerate the content-verified broken AI bios (39 total — 36 via the backfill script, 3 during eval).

**Architecture:** All generation logic lives in `generateArtistBio()` in `src/server/utils/queries/artistBioQuery.ts` — we rewrite its system prompt, add authoritative-identifier anchors to the prompt, and enable Google Search grounding unconditionally. Bio rendering markdown is extracted to a testable, HTML-escaping helper. A one-off `tsx` script regenerates the broken bios through the new pipeline.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, `@google/genai` (Gemini 2.5 Pro + Google Search grounding), Jest 30, `npx tsx` for the script.

## Global Constraints

- Package manager: `npm` (Node 20). Match existing file indentation.
- Server env vars come from `@/env`, never `process.env` (except the standalone script, which follows the existing `scripts/refetch-vault-sources.ts` pattern of `dotenv` + `process.env.SUPABASE_DB_CONNECTION`).
- Bio voice: ONE paragraph, ≤ ~100 words, factual encyclopedia register. Never invent facts. Pronouns: she/he/they only when clearly documented in sources; else they/them; never guess a gendered pronoun.
- Foundation already committed (`b986b53c`): `sanitizeBioText` exists in `src/lib/bioText.ts` and is applied in `useArtistBio` and in `generateArtistBio` before persisting. Keep it.
- Backfill (Task 3) writes to the **production** DB and is gated on explicit user go-ahead at run time. It must select ONLY bios carrying an AI signature.

---

### Task 1: XSS-harden bio markdown rendering

`renderMarkdown` in `BlurbSection.tsx` injects regex output via `dangerouslySetInnerHTML` without escaping HTML — a stored-XSS vector (artist editors PUT arbitrary bio text). Extract it to a testable helper that escapes HTML before applying bold/italic.

**Files:**
- Create: `src/lib/renderBioMarkdown.ts`
- Create: `src/lib/__tests__/renderBioMarkdown.test.ts`
- Modify: `src/app/artist/[id]/_components/BlurbSection.tsx` (remove local `renderMarkdown`, import the helper)

**Interfaces:**
- Produces: `renderBioMarkdown(text: string | null | undefined): string` — returns HTML-safe string containing only `<strong>`/`<em>` tags.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/renderBioMarkdown.test.ts
import { renderBioMarkdown } from "../renderBioMarkdown";

describe("renderBioMarkdown", () => {
  it("escapes HTML so script injection cannot execute", () => {
    const result = renderBioMarkdown('<script>alert(1)</script>');
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("escapes an img onerror payload", () => {
    const result = renderBioMarkdown('<img src=x onerror="alert(1)">');
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
  });

  it("still converts **bold** and *italic*", () => {
    expect(renderBioMarkdown("The **WILD LIFE** EP is her *sharpest* work."))
      .toBe("The <strong>WILD LIFE</strong> EP is her <em>sharpest</em> work.");
  });

  it("escapes ampersands without breaking text", () => {
    expect(renderBioMarkdown("Simon & Garfunkel")).toBe("Simon &amp; Garfunkel");
  });

  it("handles null/undefined/empty", () => {
    expect(renderBioMarkdown(null)).toBe("");
    expect(renderBioMarkdown(undefined)).toBe("");
    expect(renderBioMarkdown("")).toBe("");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx jest src/lib/__tests__/renderBioMarkdown.test.ts`
Expected: FAIL — `Cannot find module '../renderBioMarkdown'`.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/renderBioMarkdown.ts
/**
 * Convert the limited markdown a bio may contain (**bold**, *italic*) to HTML,
 * escaping all other HTML first so bio text can never inject live markup.
 * Bios are AI-generated or artist-edited and rendered via dangerouslySetInnerHTML,
 * so escaping before formatting is what makes that render safe.
 */
export function renderBioMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx jest src/lib/__tests__/renderBioMarkdown.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the helper into BlurbSection**

In `src/app/artist/[id]/_components/BlurbSection.tsx`:
- Delete the local `renderMarkdown` function (the `/** Convert **bold** … */` block and its body).
- Add near the top imports: `import { renderBioMarkdown } from "@/lib/renderBioMarkdown";`
- Change the render site from `dangerouslySetInnerHTML={{ __html: renderMarkdown(aiBlurb) }}` to `dangerouslySetInnerHTML={{ __html: renderBioMarkdown(aiBlurb) }}`.

- [ ] **Step 6: Verify nothing else broke**

Run: `npx jest src/__tests__/components/BlurbSection.test.tsx src/lib/__tests__/renderBioMarkdown.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/renderBioMarkdown.ts src/lib/__tests__/renderBioMarkdown.test.ts "src/app/artist/[id]/_components/BlurbSection.tsx"
git commit -m "fix: escape HTML in bio markdown rendering (close stored-XSS in BlurbSection)"
```

---

### Task 2: Factual voice prompt + identifier anchors + always-on grounding

Rewrite the bio generation prompt to the factual voice, feed the DB's existing MusicBrainz/Wikipedia/Discogs/Wikidata identifiers into the prompt as authoritative anchors (fixing the Wikipedia-slug bug), and enable Google Search grounding for every bio.

**Files:**
- Modify: `src/server/utils/queries/artistBioQuery.ts`
- Modify: `src/server/utils/queries/__tests__/artistBioQuery.test.ts`

**Interfaces:**
- Consumes: `getArtistById()` returns an artist row with `wikipedia`, `musicbrainz`, `discogs`, `wikidata` (all `string | null`).
- Produces: no signature change — `generateArtistBio(artistId)` still returns `NextResponse`.

- [ ] **Step 1: Write failing tests for anchors + always-on grounding**

Add these tests to `src/server/utils/queries/__tests__/artistBioQuery.test.ts` (inside the `describe("artistBioQuery", …)` block, after the existing generateArtistBio tests):

```typescript
it("enables Google Search grounding even with no vault sources", async () => {
  const { generateArtistBio, getArtistById } = await setup();
  getArtistById.mockResolvedValue({
    id: "artist-1", name: "Test Artist", spotify: "sp1",
    instagram: null, x: null, soundcloud: null, youtube: null,
    youtubechannel: null, wikipedia: null, musicbrainz: null,
    discogs: null, wikidata: null,
  });

  await generateArtistBio("artist-1");

  const callArgs = (mockGenerateContent as jest.Mock).mock.calls[0][0];
  expect(callArgs.config.tools).toEqual([{ googleSearch: {} }]);
});

it("passes identifier anchors as full URLs in the prompt", async () => {
  const { generateArtistBio, getArtistById } = await setup();
  getArtistById.mockResolvedValue({
    id: "artist-1", name: "Test Artist", spotify: null,
    instagram: null, x: null, soundcloud: null, youtube: null,
    youtubechannel: null,
    wikipedia: "Test_Artist",
    musicbrainz: "abc-123",
    discogs: "999",
    wikidata: "Q42",
  });

  await generateArtistBio("artist-1");

  const contents = (mockGenerateContent as jest.Mock).mock.calls[0][0].contents;
  expect(contents).toContain("https://en.wikipedia.org/wiki/Test_Artist");
  expect(contents).toContain("https://musicbrainz.org/artist/abc-123");
  expect(contents).toContain("https://www.discogs.com/artist/999");
  expect(contents).toContain("https://www.wikidata.org/wiki/Q42");
  // regression: never the bare slug
  expect(contents).not.toMatch(/Wikipedia:\s*Test_Artist(?!\/|")/);
});
```

- [ ] **Step 2: Run the new tests, verify they fail**

Run: `npx jest src/server/utils/queries/__tests__/artistBioQuery.test.ts -t "grounding even with no vault"`
Expected: FAIL — `tools` is `undefined` (grounding currently only fires with vault sources).

Run: `npx jest src/server/utils/queries/__tests__/artistBioQuery.test.ts -t "identifier anchors as full URLs"`
Expected: FAIL — anchor URLs absent (only `wikipedia` slug is passed today).

- [ ] **Step 3: Add anchors to `promptParts`**

In `artistBioQuery.ts`, replace the current Wikipedia line:

```typescript
  if (artist.wikipedia) promptParts.push(`Wikipedia: ${artist.wikipedia}`);
```

with the anchor block (labeled so grounding disambiguates the exact artist):

```typescript
  // Authoritative identity anchors — the IDs/links MusicNerd already stores.
  // Formatted as real URLs so Google Search grounding confirms exactly which
  // artist this is and reads the right sources.
  const anchors: string[] = [];
  if (artist.wikipedia) anchors.push(`Wikipedia: https://en.wikipedia.org/wiki/${artist.wikipedia}`);
  if (artist.musicbrainz) anchors.push(`MusicBrainz: https://musicbrainz.org/artist/${artist.musicbrainz}`);
  if (artist.discogs) anchors.push(`Discogs: https://www.discogs.com/artist/${artist.discogs}`);
  if (artist.wikidata) anchors.push(`Wikidata: https://www.wikidata.org/wiki/${artist.wikidata}`);
  if (anchors.length > 0) {
    promptParts.push(
      `Authoritative identity anchors (use these to confirm exactly which artist this is; prefer facts they support):\n${anchors.join("\n")}`
    );
  }
```

- [ ] **Step 4: Rewrite the voice prompt**

Replace the entire `musicNerdVoice` template literal (the `const musicNerdVoice = \`…\`;` block) with:

```typescript
    const musicNerdVoice = `You write clean, factual artist bios for MusicNerd, a music discovery platform. Think well-written encyclopedia entry, not a review or press release. Tell the reader who this artist is and what they're known for — accurately, without embellishment.

Write ONE paragraph, up to ~100 words. Shorter is better than padded: if verified facts are thin, write two or three honest sentences.

Structure:
- Open with the name and what they are: "[Name] is a [role/genre] from [place]." This is the one place a plain identity sentence is correct — lead with it.
- Follow with the most significant verifiable facts: bands, notable releases, collaborators, milestones, dates, well-documented activity outside music.
- Stop when the facts run out. No closing "significance" flourish.

Rules:
- Third person. Anchor on the name; use pronouns sparingly.
- Pronouns: use she/he/they only as the artist is clearly documented to use them in your sources. If unclear, use they/them. Never guess a gendered pronoun.
- State only what your sources support. Never invent bands, releases, collaborators, places, or dates. If unsure a fact is true, leave it out.
- No editorializing. Don't tell the reader why the work "matters," don't say the artist is "showing" or "proving" something, and don't append interpretive clauses to facts. Report the fact and stop.
- Banned hype words: "emerging", "rising", "boundary-pushing", "eclectic", "versatile", "undeniable", "sonic", "soundscape", "artist to watch", "cross-genre draw", "carving out". Banned resume-speak: "leveraged", "spearheaded", "secured", "integrated".
- Plain, direct sentences.`;
```

Leave the `hasVaultContext` branch that appends the "PRIMARY source" paragraph as-is — it composes on top of the new voice.

- [ ] **Step 5: Enable grounding unconditionally**

Replace:

```typescript
    // Use Google Search grounding when vault sources exist (allows Gemini to visit those URLs)
    const useGrounding = hasVaultContext && vaultUrls.length > 0;
```

with:

```typescript
    // Grounding is always on: bios must be factual, and grounding lets Gemini
    // read the anchor URLs and the open web. Bios are cached, so the added
    // latency is not on any user's critical path.
    const useGrounding = true;
```

(The existing `...(useGrounding ? { tools: [{ googleSearch: {} }] } : {})` spread stays; `vaultUrls` is still used for vault context, so leave it.)

- [ ] **Step 6: Update the existing grounding test that assumed conditional grounding**

The existing test `"uses Google Search grounding when vault sources exist"` still passes (grounding is present with vault sources). If any existing test asserts grounding is ABSENT without vault sources, or asserts the old `Wikipedia: <slug>` format, update it to the new behavior. Run the whole file to find breakage:

Run: `npx jest src/server/utils/queries/__tests__/artistBioQuery.test.ts`
Expected: all PASS after adjusting any such assertion. Fix failing assertions to match always-on grounding / URL anchors — do not weaken the two new tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/utils/queries/artistBioQuery.ts src/server/utils/queries/__tests__/artistBioQuery.test.ts
git commit -m "feat: factual bio voice, identifier anchors, always-on grounding"
```

---

### Task 3: Backfill script for the broken AI bios (gated) — 39 total

One-off `tsx` script. Default run is a **dry run** that prints the matched set; `--write` regenerates each through the new pipeline. Selection matches ONLY AI-signature bios, so artist-written bios are never touched.

**Files:**
- Create: `scripts/backfill-ai-bios.ts`

**Interfaces:**
- Consumes: `regenerateArtistBio(artistId: string): Promise<string | null>` from `@/server/utils/queries/artistBioQuery` (regenerates + persists via the new pipeline).

- [ ] **Step 1: Write the script**

```typescript
// scripts/backfill-ai-bios.ts
/**
 * One-off: regenerate the broken AI-generated bios through the new factual pipeline.
 * Selects ONLY bios carrying an AI signature (citation links, leaked prompt
 * scaffolding, or an AI refusal) — never touches artist-written bios.
 *
 * Dry run (prints matches, writes nothing):  npx tsx scripts/backfill-ai-bios.ts
 * Live run (regenerates + writes to prod):    npx tsx scripts/backfill-ai-bios.ts --write
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { regenerateArtistBio } from "@/server/utils/queries/artistBioQuery";

const WRITE = process.argv.includes("--write");

const client = postgres(process.env.SUPABASE_DB_CONNECTION!, { prepare: false });
const db = drizzle(client, { schema });

// AI-signature predicate — must exactly mirror the spec's Part C selection.
// `%](http%` (a bare LIKE) catches markdown citation links without regex
// paren-balancing hazards inside the template literal.
const AI_SIGNATURE = sql`(
  bio LIKE '%](http%'
  OR bio ILIKE '%utm_source=openai%'
  OR bio ILIKE '%Identify the artist%'
  OR bio ILIKE '%Retrieve verified information%'
  OR bio ILIKE '%Checklist:%'
  OR bio ILIKE '%I could not find%'
  OR bio ILIKE '%I''m sorry%'
)`;

async function main() {
  const rows = await db.execute<{ id: string; name: string; bio: string }>(
    sql`SELECT id, name, bio FROM artists WHERE ${AI_SIGNATURE} ORDER BY name`
  );
  const artists = rows as unknown as { id: string; name: string; bio: string }[];

  console.log(`Matched ${artists.length} AI-signature bios:\n`);
  for (const a of artists) {
    console.log(`  • ${a.name} (${a.id})`);
  }

  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write to regenerate.`);
    await client.end();
    return;
  }

  console.log(`\n--write set. Regenerating ${artists.length} bios through the new pipeline…\n`);
  let ok = 0, failed = 0;
  for (const a of artists) {
    try {
      const bio = await regenerateArtistBio(a.id);
      if (bio) {
        ok++;
        console.log(`  [ok]   ${a.name}\n         → ${bio.slice(0, 120)}…`);
      } else {
        failed++;
        console.log(`  [FAIL] ${a.name} — generator returned null`);
      }
    } catch (e) {
      failed++;
      console.log(`  [FAIL] ${a.name} — ${(e as Error).message}`);
    }
    // small delay to respect Gemini rate limits
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`\nDone. ${ok} regenerated, ${failed} failed.`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run to verify selection (no writes)**

Run: `npx tsx scripts/backfill-ai-bios.ts`
Expected: prints the matched set (~36–39, incl. KIRINJI, SLIGHT, Yani Mo, Bea Maher, and "I'm sorry…" AI refusals like 1000 Eyes, chauncy, Playd3ad) and `DRY RUN — nothing written.` The verified true count is 39 broken AI bios; 3 (Alissa, Cocteau Twins, Daegho) were already fixed during Task 4 eval, so the dry run shows the remainder.
If the count is wildly off (e.g. hundreds), STOP — the predicate is over-matching; do not run `--write`.

- [ ] **Step 3: Commit the script (dry-run verified; live run deferred)**

```bash
git add scripts/backfill-ai-bios.ts
git commit -m "chore: gated backfill script to regenerate broken AI bios"
```

- [ ] **Step 4: Live backfill — GATED on explicit user go-ahead**

Do NOT run this without the user confirming. When confirmed:

Run: `npx tsx scripts/backfill-ai-bios.ts --write`
Expected: each artist logged `[ok]` with a new factual bio preview; final tally. Re-run the dry run afterward — expected `Matched 0` (all signatures cleared).

---

### Task 4: Manual eval + full verification

Unit tests prove wiring, not writing quality. Eyeball real output, then run the full pre-push suite.

**Files:** none (verification only).

- [ ] **Step 1: Regenerate three representative bios locally and read them**

Ensure the plain-HTTP dev server is running (`npx next dev -p 3000`). For each artist, force regeneration and read the result:

```bash
# Alissa White-Gluz (rich, gendered)
curl -s "http://localhost:3000/api/artistBio/4ed03b76-f614-4d86-8514-7d92e8f6ce8c?regenerate=true" | python3 -c "import sys,json;print(json.load(sys.stdin)['bio'])"
# Cocteau Twins (band)
curl -s "http://localhost:3000/api/artistBio/48254a49-1bd6-41cf-8066-263fb40778f8?regenerate=true" | python3 -c "import sys,json;print(json.load(sys.stdin)['bio'])"
# Daegho (thin data)
curl -s "http://localhost:3000/api/artistBio/1539da14-f1dc-4fd5-a50a-b9b70818faf3?regenerate=true" | python3 -c "import sys,json;print(json.load(sys.stdin)['bio'])"
```

Confirm each: name-anchored opener, factual, no significance-tags, correct/neutral pronouns, no invented facts, ≤ ~100 words, thin-data one stays short. If a rule is violated, iterate on the Task 2 prompt wording and re-run.

- [ ] **Step 2: Run the full pre-push suite**

Run: `npm run type-check && npm run lint && npm run test`
Expected: type-check clean, lint clean (pre-existing warnings only), all tests pass.

Run: `npm run build`
Expected: build succeeds (requires `.env.local`).

- [ ] **Step 3: Final commit if any eval-driven prompt tweaks were made**

```bash
git add src/server/utils/queries/artistBioQuery.ts
git commit -m "chore: bio prompt tuning from manual eval"
```

---

## Self-Review

**Spec coverage:**
- Voice rewrite → Task 2 Step 4 ✅
- Length ceiling / thin-data → Task 2 Step 4 (in prompt) + Task 4 Step 1 eval ✅
- Pronoun rule → Task 2 Step 4 (in prompt) ✅
- Grounding always on → Task 2 Steps 1,5 ✅
- Identifier anchors + Wikipedia-URL bug fix → Task 2 Steps 1,3 ✅
- Keep `sanitizeBioText` → foundation commit `b986b53c` (Global Constraints) ✅
- XSS hardening → Task 1 ✅
- Backfill (AI-signature only, gated; 39 total = 36 via script + 3 in eval) → Task 3 ✅
- Provenance follow-up / no bulk-regen → honored by Task 3 selection predicate ✅

**Placeholder scan:** No TBD/TODO; all code blocks complete; prompt text included verbatim.

**Type consistency:** `renderBioMarkdown(string|null|undefined): string`, `regenerateArtistBio(string): Promise<string|null>`, `generateArtistBio` unchanged. Anchor field names (`wikipedia`, `musicbrainz`, `discogs`, `wikidata`) match `schema.ts`.

## Follow-ups (out of scope — flagged, not built)

- Dedicated MusicBrainz/Discogs/Wikipedia API fetch for structured facts.
- Bio provenance flag (AI vs artist-edited) so future cleanups don't content-sniff.
- Apply the factual voice to `askArtist` Q&A.
- Backfill the 28 legacy dirty bios' non-AI siblings — N/A (none exist).
