# Post-Claim Conversational Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an admin approves an artist's claim, the artist gets an approval email and, on their next visit to their artist page, a chat-driven onboarding that confirms their platform links, curates their vault, runs a 3-question interview, and publishes an About + a durable artist doc that feeds askArtist, bios, and fun facts.

**Architecture:** Forced-step chat: the server owns a fixed step sequence (`profiles → vault → interview → publish`) derived from explicit per-step confirmation rows — no stored cursor, no transcript persistence. Each chat turn is one POST returning one SSE stream (60s ceiling). Gemini (existing `@google/genai`) supplies narration acks, doc synthesis, and About prose; all writes are deterministic server code.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle/Postgres (RLS role `mnweb`), NextAuth+Privy sessions, Gemini via `@google/genai`, Resend via plain `fetch` (no SDK), Jest 30 + RTL.

**Spec:** `docs/superpowers/specs/2026-08-17-post-claim-onboarding-design.md` — read it before starting any task.

## Global Constraints

- Package manager is **npm**; Node **20**. **Zero new runtime dependencies** — Resend is called via `fetch`, chat streaming is hand-rolled SSE, Gemini stays on `@google/genai`.
- Brand is **"Music Nerd"** (two words) in every user-facing string, email, and prompt.
- Server code reads env via `@/env`, never `process.env` directly.
- New API routes: `export const dynamic = "force-dynamic"`, named HTTP-method exports, `params` is a `Promise` (always `await params`).
- Every new table ships all four `mnweb` RLS policies with real expressions (`using: sql\`true\``, `withCheck: sql\`true\``) — verify they appear in the generated migration (prod-outage precedent: `drizzle/0010`).
- DB writes on the new tables use `ON CONFLICT` upserts (two-tab safety). All step handlers must be idempotent.
- The doc→bio write happens ONLY in the explicit publish turn. Nothing else may touch `artists.bio` implicitly.
- Interview questions are all skippable; nudge copy frames gaps as the next win, never as shame.
- Conventional commits on branch `pete/recoup-onboarding-exploration`. Before any push: `npm run type-check && npm run lint && npm run test && npm run build`.
- Indentation: match the file you're editing (repo mixes 2 and 4 spaces).

---

### Task 1: Schema + migration (3 tables, relations, RLS)

**Files:**
- Modify: `src/server/db/schema.ts` (append after `artistBioVersions` block ~line 411; extend `artistsRelations`)
- Create: `drizzle/0011_*.sql` (via `npm run db:generate`)

**Interfaces:**
- Consumes: existing `artists`, `pgPolicy`, `sql`, `unique`, `foreignKey`, `index` imports (all already imported in schema.ts).
- Produces: Drizzle tables `artistDocs`, `artistInterviewAnswers`, `artistOnboardingSteps` exported from `@/server/db/schema`, each with `artistId` FK → `artists.id` ON DELETE CASCADE. Later tasks import these exact names.

- [ ] **Step 1: Add the three tables to `src/server/db/schema.ts`** (after the `artistBioVersions` table definition):

```ts
// Post-claim onboarding: the artist knowledgebase doc (one current doc per artist).
export const artistDocs = pgTable("artist_docs", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	artistId: uuid("artist_id").notNull(),
	content: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
}, (table) => [
	unique("artist_docs_artist_id_key").on(table.artistId),
	foreignKey({
		columns: [table.artistId],
		foreignColumns: [artists.id],
		name: "artist_docs_artist_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("mnweb_select_artist_docs", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_artist_docs", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
	pgPolicy("mnweb_update_artist_docs", { as: "permissive", for: "update", to: ["mnweb"], using: sql`true`, withCheck: sql`true` }),
	pgPolicy("mnweb_delete_artist_docs", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
]);

// Raw interview answers — the artist's own words, never lost to doc regeneration.
// answer NULL = explicitly skipped (counts as asked; returns to the follow-up bank).
export const artistInterviewAnswers = pgTable("artist_interview_answers", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	artistId: uuid("artist_id").notNull(),
	questionKey: text("question_key").notNull(),
	question: text().notNull(),
	answer: text(),
	source: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
}, (table) => [
	unique("artist_interview_answers_artist_question_uniq").on(table.artistId, table.questionKey),
	index("idx_artist_interview_answers_artist_id").using("btree", table.artistId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.artistId],
		foreignColumns: [artists.id],
		name: "artist_interview_answers_artist_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("mnweb_select_artist_interview_answers", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_artist_interview_answers", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
	pgPolicy("mnweb_update_artist_interview_answers", { as: "permissive", for: "update", to: ["mnweb"], using: sql`true`, withCheck: sql`true` }),
	pgPolicy("mnweb_delete_artist_interview_answers", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
]);

// Step confirmations: "the artist saw and confirmed it", not "data exists".
// Written ONLY by explicit artist actions in the onboarding chat.
export const artistOnboardingSteps = pgTable("artist_onboarding_steps", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	artistId: uuid("artist_id").notNull(),
	step: text().notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
}, (table) => [
	unique("artist_onboarding_steps_artist_step_uniq").on(table.artistId, table.step),
	index("idx_artist_onboarding_steps_artist_id").using("btree", table.artistId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.artistId],
		foreignColumns: [artists.id],
		name: "artist_onboarding_steps_artist_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("mnweb_select_artist_onboarding_steps", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_artist_onboarding_steps", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
	pgPolicy("mnweb_delete_artist_onboarding_steps", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
	// No UPDATE policy: confirmation rows are insert-once, delete-on-revoke.
]);
```

- [ ] **Step 2: Extend relations** — in the existing `artistsRelations` list add three lines, and add three new relation exports at the end of the file:

```ts
// inside artistsRelations = relations(artists, ({one, many}) => ({ ... add:
	artistDocs: many(artistDocs),
	artistInterviewAnswers: many(artistInterviewAnswers),
	artistOnboardingSteps: many(artistOnboardingSteps),
```

```ts
export const artistDocsRelations = relations(artistDocs, ({one}) => ({
	artist: one(artists, { fields: [artistDocs.artistId], references: [artists.id] }),
}));

export const artistInterviewAnswersRelations = relations(artistInterviewAnswers, ({one}) => ({
	artist: one(artists, { fields: [artistInterviewAnswers.artistId], references: [artists.id] }),
}));

export const artistOnboardingStepsRelations = relations(artistOnboardingSteps, ({one}) => ({
	artist: one(artists, { fields: [artistOnboardingSteps.artistId], references: [artists.id] }),
}));
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0011_<name>.sql` containing three `CREATE TABLE` statements.

- [ ] **Step 4: Verify RLS is in the generated SQL**

Run: `grep -c "CREATE POLICY" drizzle/0011_*.sql && grep -c "ENABLE ROW LEVEL SECURITY" drizzle/0011_*.sql`
Expected: 11 policies, 3 enable-RLS lines. **If either is missing**, append this block to the end of the generated file (statement-per-line with `--> statement-breakpoint` separators, mirroring `drizzle/0010`):

```sql
ALTER TABLE artist_docs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE artist_interview_answers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE artist_onboarding_steps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY mnweb_select_artist_docs ON artist_docs FOR SELECT TO mnweb USING (true);--> statement-breakpoint
CREATE POLICY mnweb_insert_artist_docs ON artist_docs FOR INSERT TO mnweb WITH CHECK (true);--> statement-breakpoint
CREATE POLICY mnweb_update_artist_docs ON artist_docs FOR UPDATE TO mnweb USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY mnweb_delete_artist_docs ON artist_docs FOR DELETE TO mnweb USING (true);--> statement-breakpoint
CREATE POLICY mnweb_select_artist_interview_answers ON artist_interview_answers FOR SELECT TO mnweb USING (true);--> statement-breakpoint
CREATE POLICY mnweb_insert_artist_interview_answers ON artist_interview_answers FOR INSERT TO mnweb WITH CHECK (true);--> statement-breakpoint
CREATE POLICY mnweb_update_artist_interview_answers ON artist_interview_answers FOR UPDATE TO mnweb USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY mnweb_delete_artist_interview_answers ON artist_interview_answers FOR DELETE TO mnweb USING (true);--> statement-breakpoint
CREATE POLICY mnweb_select_artist_onboarding_steps ON artist_onboarding_steps FOR SELECT TO mnweb USING (true);--> statement-breakpoint
CREATE POLICY mnweb_insert_artist_onboarding_steps ON artist_onboarding_steps FOR INSERT TO mnweb WITH CHECK (true);--> statement-breakpoint
CREATE POLICY mnweb_delete_artist_onboarding_steps ON artist_onboarding_steps FOR DELETE TO mnweb USING (true);
```

- [ ] **Step 5: Apply to the dev database** (targets `SUPABASE_DB_CONNECTION` from `.env.local` — this is the dev DB, safe)

Run: `npm run db:migrate`
Expected: exits 0.

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(onboarding): add artist_docs, artist_interview_answers, artist_onboarding_steps tables with mnweb RLS"
```

---

### Task 2: Onboarding queries — derivation + CRUD

**Files:**
- Create: `src/server/utils/queries/onboardingQueries.ts`
- Modify: `jest.setup.ts` (add new tables to the db mock, lines ~119-135 and the `tables` array ~line 163)
- Test: `src/server/utils/queries/__tests__/onboardingQueries.test.ts`

**Interfaces:**
- Consumes: `db` from `@/server/db/drizzle`; `artistDocs`, `artistInterviewAnswers`, `artistOnboardingSteps` from Task 1.
- Produces (exact exports later tasks rely on):
  - `ONBOARDING_STEPS: readonly ["profiles","vault","interview","publish"]`, `type OnboardingStep`, `type OnboardingState = { complete: boolean; currentStep: OnboardingStep | null }`
  - `firstUnconfirmedStep(confirmed: ReadonlySet<string>): OnboardingStep | null` (pure)
  - `getConfirmedSteps(artistId: string): Promise<Set<OnboardingStep>>`
  - `confirmOnboardingStep(artistId: string, step: OnboardingStep): Promise<void>`
  - `getOnboardingState(artistId: string): Promise<OnboardingState>`
  - `upsertInterviewAnswer(input: { artistId: string; questionKey: string; question: string; answer: string | null; source: "onboarding" | "followup" }): Promise<void>`
  - `getInterviewAnswers(artistId: string): Promise<{ questionKey: string; question: string; answer: string | null }[]>` (full rows; these fields guaranteed)
  - `upsertArtistDoc(artistId: string, content: string): Promise<void>`
  - `getArtistDoc(artistId: string): Promise<{ content: string } | undefined>` (full row; `content` guaranteed)

- [ ] **Step 1: Update `jest.setup.ts` db mock.** In the `jest.mock('@/server/db/drizzle', ...)` factory, add to `baseDb.query`:

```ts
            artistDocs: makeTable(),
            artistInterviewAnswers: makeTable(),
            artistOnboardingSteps: makeTable(),
```

and in the `tables` array of the ensure-block below it, extend to:

```ts
        const tables = ['urlmap', 'artists', 'users', 'ugcresearch', 'artistClaims', 'artistVaultSources', 'artistIdMappings', 'artistDocs', 'artistInterviewAnswers', 'artistOnboardingSteps'];
```

- [ ] **Step 2: Write the failing tests** — `src/server/utils/queries/__tests__/onboardingQueries.test.ts`:

```ts
// @ts-nocheck
import { jest } from '@jest/globals';
import {
    ONBOARDING_STEPS,
    firstUnconfirmedStep,
    getOnboardingState,
    confirmOnboardingStep,
    upsertInterviewAnswer,
    upsertArtistDoc,
} from '@/server/utils/queries/onboardingQueries';
import { db } from '@/server/db/drizzle';

describe('firstUnconfirmedStep (pure derivation)', () => {
    it('returns profiles for an empty set', () => {
        expect(firstUnconfirmedStep(new Set())).toBe('profiles');
    });
    it('returns the first gap even when later steps are confirmed (out-of-order safety)', () => {
        expect(firstUnconfirmedStep(new Set(['profiles', 'interview']))).toBe('vault');
    });
    it('returns publish when only publish remains', () => {
        expect(firstUnconfirmedStep(new Set(['profiles', 'vault', 'interview']))).toBe('publish');
    });
    it('returns null when every step is confirmed', () => {
        expect(firstUnconfirmedStep(new Set(ONBOARDING_STEPS))).toBeNull();
    });
    it('ignores unknown junk in the set', () => {
        expect(firstUnconfirmedStep(new Set(['bogus']))).toBe('profiles');
    });
});

describe('getOnboardingState', () => {
    beforeEach(() => jest.clearAllMocks());

    it('is complete only when publish is confirmed', async () => {
        db.query.artistOnboardingSteps.findMany.mockResolvedValue([
            { step: 'profiles' }, { step: 'vault' }, { step: 'interview' }, { step: 'publish' },
        ]);
        const state = await getOnboardingState('artist-1');
        expect(state).toEqual({ complete: true, currentStep: null });
    });

    it('derives the current step from confirmations, not data existence', async () => {
        db.query.artistOnboardingSteps.findMany.mockResolvedValue([{ step: 'profiles' }]);
        const state = await getOnboardingState('artist-1');
        expect(state).toEqual({ complete: false, currentStep: 'vault' });
    });

    it('fails safe (incomplete, first step) when the query throws', async () => {
        db.query.artistOnboardingSteps.findMany.mockRejectedValue(new Error('boom'));
        const state = await getOnboardingState('artist-1');
        expect(state).toEqual({ complete: false, currentStep: 'profiles' });
    });
});

describe('write paths use ON CONFLICT upserts', () => {
    beforeEach(() => jest.clearAllMocks());

    it('confirmOnboardingStep is idempotent via onConflictDoNothing', async () => {
        const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoNothing }) });
        await confirmOnboardingStep('artist-1', 'profiles');
        expect(onConflictDoNothing).toHaveBeenCalled();
    });

    it('upsertInterviewAnswer upserts on (artistId, questionKey)', async () => {
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });
        await upsertInterviewAnswer({
            artistId: 'artist-1', questionKey: 'offline_fact',
            question: 'q', answer: null, source: 'onboarding',
        });
        expect(onConflictDoUpdate).toHaveBeenCalled();
    });

    it('upsertArtistDoc upserts on artistId', async () => {
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        db.insert.mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate }) });
        await upsertArtistDoc('artist-1', '# doc');
        expect(onConflictDoUpdate).toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/server/utils/queries/__tests__/onboardingQueries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/server/utils/queries/onboardingQueries.ts`:**

```ts
import { db } from "@/server/db/drizzle";
import { eq, sql } from "drizzle-orm";
import { artistDocs, artistInterviewAnswers, artistOnboardingSteps } from "@/server/db/schema";

/**
 * Post-claim onboarding state. The step order is the chat's forced chain.
 * There is NO stored cursor: the current step is always the first step
 * lacking an explicit confirmation row (see the design spec §5).
 */
export const ONBOARDING_STEPS = ["profiles", "vault", "interview", "publish"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingState = { complete: boolean; currentStep: OnboardingStep | null };

/** Pure derivation — unit-test this, it is where the resume logic lives. */
export function firstUnconfirmedStep(confirmed: ReadonlySet<string>): OnboardingStep | null {
    for (const step of ONBOARDING_STEPS) {
        if (!confirmed.has(step)) return step;
    }
    return null;
}

export async function getConfirmedSteps(artistId: string): Promise<Set<OnboardingStep>> {
    try {
        const rows = await db.query.artistOnboardingSteps.findMany({
            where: eq(artistOnboardingSteps.artistId, artistId),
        });
        return new Set(rows.map(r => r.step as OnboardingStep));
    } catch (e) {
        console.error("[getConfirmedSteps] Error:", e);
        return new Set();
    }
}

/** Written ONLY by an explicit artist action in the chat. Idempotent (two-tab safe). */
export async function confirmOnboardingStep(artistId: string, step: OnboardingStep): Promise<void> {
    await db
        .insert(artistOnboardingSteps)
        .values({ artistId, step })
        .onConflictDoNothing({ target: [artistOnboardingSteps.artistId, artistOnboardingSteps.step] });
}

export async function getOnboardingState(artistId: string): Promise<OnboardingState> {
    const confirmed = await getConfirmedSteps(artistId);
    return { complete: confirmed.has("publish"), currentStep: firstUnconfirmedStep(confirmed) };
}

export async function upsertInterviewAnswer(input: {
    artistId: string;
    questionKey: string;
    question: string;
    answer: string | null;
    source: "onboarding" | "followup";
}): Promise<void> {
    await db
        .insert(artistInterviewAnswers)
        .values(input)
        .onConflictDoUpdate({
            target: [artistInterviewAnswers.artistId, artistInterviewAnswers.questionKey],
            set: { question: input.question, answer: input.answer, source: input.source },
        });
}

export async function getInterviewAnswers(artistId: string) {
    try {
        return await db.query.artistInterviewAnswers.findMany({
            where: eq(artistInterviewAnswers.artistId, artistId),
            orderBy: (a, { asc }) => [asc(a.createdAt)],
        });
    } catch (e) {
        console.error("[getInterviewAnswers] Error:", e);
        return [];
    }
}

export async function upsertArtistDoc(artistId: string, content: string): Promise<void> {
    await db
        .insert(artistDocs)
        .values({ artistId, content })
        .onConflictDoUpdate({
            target: [artistDocs.artistId],
            set: { content, updatedAt: sql`(now() AT TIME ZONE 'utc'::text)` },
        });
}

export async function getArtistDoc(artistId: string) {
    try {
        return await db.query.artistDocs.findFirst({
            where: eq(artistDocs.artistId, artistId),
        });
    } catch (e) {
        console.error("[getArtistDoc] Error:", e);
        return undefined;
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/server/utils/queries/__tests__/onboardingQueries.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/server/utils/queries/onboardingQueries.ts src/server/utils/queries/__tests__/onboardingQueries.test.ts jest.setup.ts
git commit -m "feat(onboarding): derived onboarding state + doc/interview/step queries"
```

---

### Task 3: Revocation cleanup (regression-critical)

**Files:**
- Modify: `src/server/utils/queries/dashboardQueries.ts` (imports line 3; `revokeApprovedClaim` lines 172-198)
- Test: `src/server/utils/queries/__tests__/revokeOnboardingCleanup.test.ts`

**Interfaces:**
- Consumes: `artistDocs`, `artistInterviewAnswers`, `artistOnboardingSteps` from schema.
- Produces: unchanged signature `revokeApprovedClaim(claimId: string)` — now also wipes onboarding content in the same transaction.

**Why this matters:** revoke exists so a re-claimer never inherits the previous owner's content. Without this change, the old `artist_docs` row makes onboarding look complete for the next claimant, and the old owner's verbatim interview quotes keep feeding askArtist/bios under the new owner's name.

- [ ] **Step 1: Write the failing test** — `src/server/utils/queries/__tests__/revokeOnboardingCleanup.test.ts`:

```ts
// @ts-nocheck
import { jest } from '@jest/globals';
import { db } from '@/server/db/drizzle';

// Track which schema table each tx.delete()/tx.update() call targeted.
// Deletes on the claim row and artist_docs use .returning(); the vault/answers/steps
// deletes are awaited directly, so their mock resolves at .where().
function makeTx(docRowsDeleted) {
    const schema = require('@/server/db/schema');
    const deletedTables = [];
    const updatedTables = [];
    const tx = {
        delete: jest.fn((table) => {
            deletedTables.push(table);
            if (table === schema.artistClaims) {
                return { where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ id: 'claim-1', artistId: 'artist-1', status: 'approved', referenceCode: 'MN-TEST' }]) }) };
            }
            if (table === schema.artistDocs) {
                return { where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue(docRowsDeleted) }) };
            }
            return { where: jest.fn().mockResolvedValue(undefined) };
        }),
        update: jest.fn((table) => {
            updatedTables.push(table);
            return { set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) };
        }),
    };
    return { tx, deletedTables, updatedTables };
}

describe('revokeApprovedClaim wipes onboarding content in the same transaction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('deletes vault sources, interview answers, onboarding steps, and the doc; clears bio when a doc existed', async () => {
        const schema = require('@/server/db/schema');
        const { tx, deletedTables, updatedTables } = makeTx([{ id: 'doc-1' }]);
        db.transaction = jest.fn(async (cb) => cb(tx));

        const { revokeApprovedClaim } = require('@/server/utils/queries/dashboardQueries');
        const result = await revokeApprovedClaim('claim-1');

        expect(result).toMatchObject({ artistId: 'artist-1' });
        expect(deletedTables).toEqual(expect.arrayContaining([
            schema.artistClaims, schema.artistVaultSources,
            schema.artistInterviewAnswers, schema.artistOnboardingSteps, schema.artistDocs,
        ]));
        // A doc was deleted → the (doc-derived or hand-edited) bio is the revoked owner's content
        expect(updatedTables).toEqual(expect.arrayContaining([schema.artists]));
    });

    it('does NOT clear the bio when no doc row existed (owner never published)', async () => {
        const { tx, updatedTables } = makeTx([]);
        db.transaction = jest.fn(async (cb) => cb(tx));

        const { revokeApprovedClaim } = require('@/server/utils/queries/dashboardQueries');
        await revokeApprovedClaim('claim-1');

        expect(updatedTables).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/server/utils/queries/__tests__/revokeOnboardingCleanup.test.ts`
Expected: FAIL — the onboarding tables are never deleted.

- [ ] **Step 3: Implement.** In `dashboardQueries.ts`, extend the schema import (line 3):

```ts
import { artistClaims, artistVaultSources, artistBioVersions, artists, artistDocs, artistInterviewAnswers, artistOnboardingSteps } from "@/server/db/schema";
```

Inside `revokeApprovedClaim`, after the existing `artistVaultSources` delete, add:

```ts
            // Onboarding content is the revoked owner's — it must not survive for
            // (or silently skip onboarding of) the next claimant. Same tx as the
            // vault wipe, same invariant (see spec §5).
            await tx
                .delete(artistInterviewAnswers)
                .where(eq(artistInterviewAnswers.artistId, deleted.artistId));
            await tx
                .delete(artistOnboardingSteps)
                .where(eq(artistOnboardingSteps.artistId, deleted.artistId));
            const deletedDocs = await tx
                .delete(artistDocs)
                .where(eq(artistDocs.artistId, deleted.artistId))
                .returning();
            if (deletedDocs.length > 0) {
                // The owner published — the live bio (doc-generated or later hand-edited)
                // is their content. Clear it so the next state regenerates from scratch.
                await tx
                    .update(artists)
                    .set({ bio: null })
                    .where(eq(artists.id, deleted.artistId));
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/server/utils/queries/__tests__/revokeOnboardingCleanup.test.ts`
Expected: PASS. Also run `npx jest src/server/utils/queries` to confirm no existing dashboardQueries tests broke.

- [ ] **Step 5: Commit**

```bash
git add src/server/utils/queries/dashboardQueries.ts src/server/utils/queries/__tests__/revokeOnboardingCleanup.test.ts
git commit -m "fix(onboarding): revocation wipes artist doc, interview answers, and step confirmations in-transaction"
```

---

### Task 4: Approval email (Resend via fetch)

**Files:**
- Modify: `src/env.ts` (append)
- Create: `src/server/utils/email.ts`
- Modify: `src/app/actions/adminClaimActions.ts` (imports; `approveClaimAction` after line 35)
- Test: `src/server/utils/__tests__/email.test.ts`, `src/app/actions/__tests__/approveClaimEmail.test.ts`

**Interfaces:**
- Consumes: `RESEND_API_KEY`, `NEXTAUTH_URL` from `@/env`; `getUserById` from `@/server/utils/queries/userQueries`; `getArtistById` from `@/server/utils/queries/artistQueries`.
- Produces: `sendEmail(input: { to: string; subject: string; html: string }): Promise<boolean>` and `sendClaimApprovedEmail(to: string, artistName: string, artistId: string): Promise<boolean>` from `@/server/utils/email`.

- [ ] **Step 1: Add to `src/env.ts`** (after the Gemini line):

```ts
// Resend (transactional email — approval notifications). Empty = sends are skipped.
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
```

- [ ] **Step 2: Write the failing tests.**

`src/server/utils/__tests__/email.test.ts`:

```ts
// @ts-nocheck
import { jest } from '@jest/globals';

describe('sendEmail', () => {
    beforeEach(() => { jest.resetModules(); global.fetch = jest.fn(); });

    it('skips (returns false) without throwing when RESEND_API_KEY is empty', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: '', NEXTAUTH_URL: '' }));
        const { sendEmail } = await import('@/server/utils/email');
        await expect(sendEmail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' })).resolves.toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('POSTs to Resend with bearer auth and returns true on 200', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: 'rk_test', NEXTAUTH_URL: '' }));
        global.fetch.mockResolvedValue({ ok: true });
        const { sendEmail } = await import('@/server/utils/email');
        await expect(sendEmail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' })).resolves.toBe(true);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.resend.com/emails');
        expect(init.headers.Authorization).toBe('Bearer rk_test');
        expect(JSON.parse(init.body).to).toEqual(['a@b.c']);
    });

    it('returns false (never throws) on a failed response', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: 'rk_test', NEXTAUTH_URL: '' }));
        global.fetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'bad' });
        const { sendEmail } = await import('@/server/utils/email');
        await expect(sendEmail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' })).resolves.toBe(false);
    });
});

describe('sendClaimApprovedEmail', () => {
    beforeEach(() => { jest.resetModules(); global.fetch = jest.fn().mockResolvedValue({ ok: true }); });

    it('links the CTA to the artist page and uses Music Nerd (two words) branding', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: 'rk_test', NEXTAUTH_URL: 'https://staging.musicnerd.xyz' }));
        const { sendClaimApprovedEmail } = await import('@/server/utils/email');
        await sendClaimApprovedEmail('artist@example.com', 'Nova Reyes', 'artist-uuid-1');
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.html).toContain('https://staging.musicnerd.xyz/artist/artist-uuid-1');
        expect(body.html).toContain('Music Nerd');
        expect(body.html).not.toMatch(/MusicNerd[^ ]/);
    });
});
```

`src/app/actions/__tests__/approveClaimEmail.test.ts`:

```ts
// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
    approveClaim: jest.fn(), rejectClaim: jest.fn(), getAllClaims: jest.fn(),
    getClaimById: jest.fn(), revokeApprovedClaim: jest.fn(),
}));
jest.mock('@/server/utils/queries/vaultWebSearch', () => ({ searchAndPopulateVault: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/queries/discord', () => ({ sendDiscordMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/server/utils/email', () => ({ sendClaimApprovedEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/app/api/mcp/audit', () => ({ logMcpAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/server/lib/supabase', () => ({ getSupabaseAdmin: jest.fn(), VAULT_BUCKET: 'vault' }));

const flush = () => new Promise(r => setTimeout(r, 0));

describe('approveClaimAction sends the approval email', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ email }) {
        const { getServerAuthSession } = await import('@/server/auth');
        const { getUserById } = await import('@/server/utils/queries/userQueries');
        const { approveClaim } = await import('@/server/utils/queries/dashboardQueries');
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { sendClaimApprovedEmail } = await import('@/server/utils/email');

        getServerAuthSession.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@x.y' } });
        // First getUserById call = admin check; second = claimant lookup
        getUserById
            .mockResolvedValueOnce({ id: 'admin-1', isAdmin: true })
            .mockResolvedValueOnce({ id: 'user-9', email });
        approveClaim.mockResolvedValue({ id: 'claim-1', artistId: 'artist-1', userId: 'user-9', referenceCode: 'MN-TEST' });
        getArtistById.mockResolvedValue({ id: 'artist-1', name: 'Nova Reyes' });

        const { approveClaimAction } = await import('@/app/actions/adminClaimActions');
        return { approveClaimAction, sendClaimApprovedEmail };
    }

    it('emails the claimant when they have an email', async () => {
        const { approveClaimAction, sendClaimApprovedEmail } = await setup({ email: 'artist@example.com' });
        const result = await approveClaimAction('claim-1');
        await flush();
        expect(result.success).toBe(true);
        expect(sendClaimApprovedEmail).toHaveBeenCalledWith('artist@example.com', 'Nova Reyes', 'artist-1');
    });

    it('skips the send (and still succeeds) when users.email is NULL — legacy wallet user', async () => {
        const { approveClaimAction, sendClaimApprovedEmail } = await setup({ email: null });
        const result = await approveClaimAction('claim-1');
        await flush();
        expect(result.success).toBe(true);
        expect(sendClaimApprovedEmail).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/server/utils/__tests__/email.test.ts src/app/actions/__tests__/approveClaimEmail.test.ts`
Expected: FAIL — `@/server/utils/email` does not exist.

- [ ] **Step 4: Implement `src/server/utils/email.ts`:**

```ts
/**
 * Transactional email via the Resend HTTP API — deliberately no SDK dependency.
 * Ops prerequisite: verify the sending domain (musicnerd.xyz) in the Resend
 * dashboard DNS settings before production sends will deliver.
 */
import { RESEND_API_KEY, NEXTAUTH_URL } from "@/env";

const FROM_ADDRESS = "Music Nerd <no-reply@musicnerd.xyz>";
const BASE_URL = NEXTAUTH_URL || "https://www.musicnerd.xyz";

export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<boolean> {
    if (!RESEND_API_KEY) {
        console.log("[email] RESEND_API_KEY not set — skipping send to", input.to);
        return false;
    }
    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: FROM_ADDRESS,
                to: [input.to],
                subject: input.subject,
                html: input.html,
            }),
        });
        if (!res.ok) {
            console.error(`[email] Resend send failed: ${res.status} ${await res.text().catch(() => "")}`);
            return false;
        }
        return true;
    } catch (e) {
        console.error("[email] Send error:", e);
        return false;
    }
}

export function claimApprovedEmailHtml(artistName: string, artistId: string): string {
    const url = `${BASE_URL}/artist/${artistId}`;
    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111;">
  <h1 style="font-size: 22px; margin: 0 0 12px;">Your profile is approved 🎉</h1>
  <p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
    You now manage <strong>${artistName}</strong> on Music Nerd. Take two minutes to finish
    setting up — confirm your links, tell us your story, and publish your About page.
  </p>
  <a href="${url}" style="display: inline-block; background: #ff4b84; color: #fff; text-decoration: none; font-weight: 600; padding: 12px 24px; border-radius: 10px; font-size: 15px;">
    Finish setting up your profile
  </a>
  <p style="font-size: 12px; color: #888; margin: 24px 0 0;">
    What you add helps Music Nerd tell your story to fans.
  </p>
</div>`;
}

export async function sendClaimApprovedEmail(to: string, artistName: string, artistId: string): Promise<boolean> {
    return sendEmail({
        to,
        subject: `Your ${artistName} profile on Music Nerd is approved 🎉`,
        html: claimApprovedEmailHtml(artistName, artistId),
    });
}
```

- [ ] **Step 5: Wire into `approveClaimAction`.** Add imports to `adminClaimActions.ts`:

```ts
import { sendClaimApprovedEmail } from "@/server/utils/email";
import { getArtistById } from "@/server/utils/queries/artistQueries";
```

Insert after the `searchAndPopulateVault` fire-and-forget (line ~35), before the Discord send:

```ts
        // Approval email — fire-and-forget; approval NEVER blocks on email.
        // Legacy wallet users may have no email; the on-page banner is the fallback channel.
        void (async () => {
            const [claimUser, artist] = await Promise.all([
                getUserById(claim.userId),
                getArtistById(claim.artistId),
            ]);
            if (!claimUser?.email) {
                console.log(`[approveClaimAction] No email for user ${claim.userId} — skipping approval email`);
                return;
            }
            await sendClaimApprovedEmail(claimUser.email, artist?.name ?? "your artist", claim.artistId);
        })().catch(e => console.error("[approveClaimAction] Approval email failed:", e));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest src/server/utils/__tests__/email.test.ts src/app/actions/__tests__/approveClaimEmail.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/env.ts src/server/utils/email.ts src/app/actions/adminClaimActions.ts src/server/utils/__tests__/email.test.ts src/app/actions/__tests__/approveClaimEmail.test.ts
git commit -m "feat(onboarding): claim-approval email via Resend with null-email guard"
```

---

### Task 5: Artist doc service (synthesis, About, capped context)

**Files:**
- Create: `src/server/utils/artistDocService.ts`
- Test: `src/server/utils/__tests__/artistDocService.test.ts`

**Interfaces:**
- Consumes: `getGemini`, `GEMINI_MODEL_FLASH` from `@/server/lib/gemini`; `getArtistById` from artistQueries; `getVaultSourcesByArtistId` from dashboardQueries; `getInterviewAnswers`, `getArtistDoc` from onboardingQueries; `MAX_BIO_LENGTH` from `@/lib/bioConstants`.
- Produces:
  - `ARTIST_DOC_MAX_CHARS = 20_000`, `ARTIST_DOC_CONTEXT_CAP = 8_000`
  - `synthesizeArtistDoc(artistId: string): Promise<string>` — markdown, throws on failure
  - `generateAboutFromDoc(artistName: string, docContent: string): Promise<string>` — plain text ≤ `MAX_BIO_LENGTH`, throws on failure
  - `getArtistDocContext(artistId: string): Promise<string | null>` — capped slice for prompt injection, null when no doc

- [ ] **Step 1: Write the failing tests** — `src/server/utils/__tests__/artistDocService.test.ts`:

```ts
// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getVaultSourcesByArtistId: jest.fn() }));
jest.mock('@/server/utils/queries/onboardingQueries', () => ({ getInterviewAnswers: jest.fn(), getArtistDoc: jest.fn() }));
jest.mock('@/server/lib/gemini', () => ({
    getGemini: jest.fn(),
    GEMINI_MODEL_FLASH: 'gemini-2.5-flash',
}));

describe('artistDocService', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ geminiText = '## Overview\nA real doc.' } = {}) {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getVaultSourcesByArtistId } = await import('@/server/utils/queries/dashboardQueries');
        const { getInterviewAnswers, getArtistDoc } = await import('@/server/utils/queries/onboardingQueries');
        const { getGemini } = await import('@/server/lib/gemini');
        const generateContent = jest.fn().mockResolvedValue({ text: geminiText });
        getGemini.mockReturnValue({ models: { generateContent } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Nova Reyes', spotify: 'spot123', instagram: 'novareyes' });
        getVaultSourcesByArtistId.mockResolvedValue([
            { title: 'Pitchfork review', url: 'https://pitchfork.com/x', snippet: 'bedroom auteur', extractedText: 'long text' },
        ]);
        getInterviewAnswers.mockResolvedValue([
            { questionKey: 'sound_in_own_words', question: 'Sound?', answer: 'heartbreak you can dance to', source: 'onboarding' },
            { questionKey: 'offline_fact', question: 'Offline?', answer: null, source: 'onboarding' },
        ]);
        const svc = await import('@/server/utils/artistDocService');
        return { svc, generateContent, getArtistDoc };
    }

    it('synthesizeArtistDoc feeds sources AND interview answers to Gemini, skipping skipped answers', async () => {
        const { svc, generateContent } = await setup();
        const doc = await svc.synthesizeArtistDoc('a1');
        expect(doc).toContain('## Overview');
        const call = generateContent.mock.calls[0][0];
        expect(call.contents).toContain('Pitchfork review');
        expect(call.contents).toContain('heartbreak you can dance to');
        expect(call.contents).not.toContain('Offline?'); // skipped answers are omitted, not sent as empties
        expect(call.config.systemInstruction).toContain('Story hooks');
        expect(call.config.tools).toBeUndefined(); // ungrounded by design
    });

    it('synthesizeArtistDoc hard-truncates at ARTIST_DOC_MAX_CHARS', async () => {
        const { svc } = await setup({ geminiText: 'x'.repeat(30_000) });
        const doc = await svc.synthesizeArtistDoc('a1');
        expect(doc.length).toBe(svc.ARTIST_DOC_MAX_CHARS);
    });

    it('generateAboutFromDoc returns trimmed text within MAX_BIO_LENGTH', async () => {
        const { svc } = await setup({ geminiText: '  A concrete About.  ' });
        await expect(svc.generateAboutFromDoc('Nova Reyes', '## Overview\ndoc')).resolves.toBe('A concrete About.');
    });

    it('getArtistDocContext caps the slice and returns null with no doc', async () => {
        const { svc, getArtistDoc } = await setup();
        getArtistDoc.mockResolvedValueOnce(undefined);
        await expect(svc.getArtistDocContext('a1')).resolves.toBeNull();
        getArtistDoc.mockResolvedValueOnce({ content: 'y'.repeat(10_000) });
        const ctx = await svc.getArtistDocContext('a1');
        expect(ctx.length).toBe(svc.ARTIST_DOC_CONTEXT_CAP);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/server/utils/__tests__/artistDocService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/utils/artistDocService.ts`:**

```ts
/**
 * The artist doc: a markdown knowledgebase compiled during post-claim onboarding.
 * Synthesis mandate is "mine, don't summarize" — see the design spec §7.
 * Both Gemini calls here are UNGROUNDED (no web search): sources + the artist's
 * own words are the entire input, which is what keeps the doc trustworthy.
 */
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { getInterviewAnswers, getArtistDoc } from "@/server/utils/queries/onboardingQueries";
import { MAX_BIO_LENGTH } from "@/lib/bioConstants";

export const ARTIST_DOC_MAX_CHARS = 20_000;
export const ARTIST_DOC_CONTEXT_CAP = 8_000;
const GEMINI_TIMEOUT_MS = 20_000;

const DOC_SYSTEM_INSTRUCTION = (artistName: string) => `You compile an internal knowledge document about the music artist "${artistName}" for Music Nerd.
Output pure markdown. Use ONLY these section headers, in this order, and OMIT any section entirely if you have no real, specific material for it:
## Overview
## Sound
## Story hooks
## Currently
## Influences & comparables
## Connections
## Aesthetic & voice
## Discography highlights

Rules:
- Mine, don't summarize: prefer one specific, tellable detail over three generic facts.
- Name real people, places, songs, venues, and dates whenever the material supports them.
- INTERVIEW ANSWERS are the artist's own words — quote them verbatim in quotation marks, never paraphrase them.
- ## Story hooks: 2-5 bullet points, each one narratable specific a fan would repeat to a friend.
- ## Connections: real collaborators, producers, scenes, and influences named in the material — one short prose paragraph.
- Never fabricate. No placeholders, no "TBD", no empty sections, no hype words ("rising star", "eclectic", "undeniable").
- Target under 800 words total.`;

const ABOUT_SYSTEM_INSTRUCTION = (artistName: string) => `You write the public "About" for the music artist "${artistName}" from their knowledge document.
- 2-4 short paragraphs, roughly 600-1,200 characters. Plain text only — no markdown, no headers.
- Concrete and specific: names, places, songs, dates. Let specifics do the work, not adjectives.
- Where the document quotes the artist, keep the quote — their words beat your words.
- No hype phrases ("rising star", "eclectic", "undeniable", "pushing boundaries").
- Never fabricate anything not in the document.`;

function withGeminiTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini timeout")), GEMINI_TIMEOUT_MS)),
    ]);
}

async function buildDocContext(artistId: string): Promise<{ artistName: string; context: string }> {
    const artist = await getArtistById(artistId);
    if (!artist) throw new Error(`Artist not found: ${artistId}`);
    const artistName = artist.name ?? "Unknown Artist";

    const parts: string[] = [];
    if (artist.spotify) parts.push(`Spotify (verified identity): https://open.spotify.com/artist/${artist.spotify}`);
    if (artist.instagram) parts.push(`Instagram: https://instagram.com/${artist.instagram}`);
    if (artist.x) parts.push(`X: https://x.com/${artist.x}`);
    if (artist.soundcloud) parts.push(`SoundCloud: ${artist.soundcloud}`);
    if (artist.youtube) parts.push(`YouTube: https://youtube.com/@${artist.youtube.replace(/^@/, "")}`);

    const sources = await getVaultSourcesByArtistId(artistId, "approved");
    if (sources.length > 0) {
        const sourceContext = sources.map(s => {
            const p = [`Source: ${s.title ?? s.url}`];
            if (s.snippet) p.push(s.snippet);
            if (s.extractedText) p.push(s.extractedText.slice(0, 2000));
            return p.join(" — ");
        }).join("\n");
        parts.push(`\n--- APPROVED SOURCES (about this exact artist) ---\n${sourceContext}\n--- END SOURCES ---`);
    }

    const answers = (await getInterviewAnswers(artistId)).filter(a => a.answer);
    if (answers.length > 0) {
        const interviewContext = answers.map(a => `Q: ${a.question}\nA (artist's own words): "${a.answer}"`).join("\n\n");
        parts.push(`\n--- INTERVIEW ANSWERS (quote verbatim) ---\n${interviewContext}\n--- END INTERVIEW ---`);
    }

    return { artistName, context: parts.join("\n") };
}

export async function synthesizeArtistDoc(artistId: string): Promise<string> {
    const { artistName, context } = await buildDocContext(artistId);
    const response = await withGeminiTimeout(
        getGemini().models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: context,
            config: {
                systemInstruction: DOC_SYSTEM_INSTRUCTION(artistName),
                temperature: 0.4,
            },
        })
    );
    const doc = response.text?.trim();
    if (!doc) throw new Error("Doc synthesis returned empty text");
    return doc.slice(0, ARTIST_DOC_MAX_CHARS);
}

export async function generateAboutFromDoc(artistName: string, docContent: string): Promise<string> {
    const response = await withGeminiTimeout(
        getGemini().models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: `ARTIST KNOWLEDGE DOCUMENT:\n${docContent}`,
            config: {
                systemInstruction: ABOUT_SYSTEM_INSTRUCTION(artistName),
                temperature: 0.5,
            },
        })
    );
    const about = response.text?.trim();
    if (!about) throw new Error("About generation returned empty text");
    return about.slice(0, MAX_BIO_LENGTH);
}

/** Capped doc slice for prompt injection (askArtist / funFacts / bio). Null when no doc. */
export async function getArtistDocContext(artistId: string): Promise<string | null> {
    const doc = await getArtistDoc(artistId);
    if (!doc?.content) return null;
    return doc.content.slice(0, ARTIST_DOC_CONTEXT_CAP);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/server/utils/__tests__/artistDocService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/utils/artistDocService.ts src/server/utils/__tests__/artistDocService.test.ts
git commit -m "feat(onboarding): artist doc synthesis + About generation with mine-don't-summarize mandate"
```

---

### Task 6: Inject the doc into askArtist, funFacts, and bio generation

**Files:**
- Modify: `src/app/api/askArtist/route.ts` (imports; after the vault-sources block ~line 66)
- Modify: `src/app/api/funFacts/[type]/route.ts` (imports; after the vault append ~line 84)
- Modify: `src/server/utils/queries/artistBioQuery.ts` (imports; after the `--- END SOURCES ---` push ~line 209)
- Test: `src/app/api/askArtist/__tests__/docInjection.test.ts`

**Interfaces:**
- Consumes: `getArtistDocContext` (and `ARTIST_DOC_CONTEXT_CAP` in bio) from `@/server/utils/artistDocService`; `getArtistDoc` from onboardingQueries (bio path only).
- Produces: no new exports — behavior change only.

- [ ] **Step 1: Write the failing test** — `src/app/api/askArtist/__tests__/docInjection.test.ts`:

```ts
// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/artistDocService', () => ({ getArtistDocContext: jest.fn() }));
jest.mock('@/server/lib/gemini', () => ({ getGemini: jest.fn(), GEMINI_MODEL_FLASH: 'gemini-2.5-flash' }));

if (!('json' in Response)) {
    Response.json = (data, init) =>
        new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            status: init?.status || 200,
        });
}

describe('POST /api/askArtist injects the artist doc', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    it('adds the ARTIST DOC block to the system instruction when a doc exists', async () => {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getArtistDocContext } = await import('@/server/utils/artistDocService');
        const { getGemini } = await import('@/server/lib/gemini');
        const generateContent = jest.fn().mockResolvedValue({ text: 'answer' });
        getGemini.mockReturnValue({ models: { generateContent } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Nova Reyes' });
        getArtistDocContext.mockResolvedValue('## Story hooks\n- records in a water tower');

        const { POST } = await import('../route');
        const res = await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'What is her studio like?' }),
        }));

        expect(res.status).toBe(200);
        const sys = generateContent.mock.calls[0][0].config.systemInstruction;
        expect(sys).toContain('--- ARTIST DOC');
        expect(sys).toContain('water tower');
    });

    it('still answers when doc lookup throws', async () => {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getArtistDocContext } = await import('@/server/utils/artistDocService');
        const { getGemini } = await import('@/server/lib/gemini');
        getGemini.mockReturnValue({ models: { generateContent: jest.fn().mockResolvedValue({ text: 'answer' }) } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Nova Reyes' });
        getArtistDocContext.mockRejectedValue(new Error('boom'));

        const { POST } = await import('../route');
        const res = await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'hello?' }),
        }));
        expect(res.status).toBe(200);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/api/askArtist/__tests__/docInjection.test.ts`
Expected: FAIL — no ARTIST DOC block in the system instruction.

- [ ] **Step 3: Implement the three injections.**

`src/app/api/askArtist/route.ts` — add import `import { getArtistDocContext } from "@/server/utils/artistDocService";` and, immediately after the vault-sources `try/catch` block (after line ~66), add:

```ts
        // Artist doc (post-claim onboarding knowledgebase) — capped slice, ground truth
        // like the vault sources. Interview quotes inside it are the artist's own words.
        try {
            const docContext = await getArtistDocContext(artistId);
            if (docContext) {
                contextParts.push(`\n--- ARTIST DOC (compiled with the artist; treat as ground truth) ---\n${docContext}\n--- END ARTIST DOC ---`);
            }
        } catch (e) {
            console.error("[askArtist] Error fetching artist doc:", e);
        }
```

`src/app/api/funFacts/[type]/route.ts` — add import `import { getArtistDocContext } from "@/server/utils/artistDocService";` and, immediately after the vault-sources `try/catch` (after the `finalPrompt += ...vaultContext` block), add:

```ts
    // Artist doc — its "Story hooks" section is exactly what fun facts want.
    try {
      const docContext = await getArtistDocContext(id);
      if (docContext) {
        finalPrompt += `\n\nArtist knowledge doc (compiled with the artist — prefer its "Story hooks"):\n${docContext}`;
      }
    } catch (e) {
      console.error("Error fetching artist doc for fun facts:", e);
    }
```

`src/server/utils/queries/artistBioQuery.ts` — add imports:

```ts
import { getArtistDoc } from "@/server/utils/queries/onboardingQueries";
import { ARTIST_DOC_CONTEXT_CAP } from "@/server/utils/artistDocService";
```

and immediately after the `promptParts.push(`\n--- SOURCES ...` line (~line 209), add:

```ts
  // The artist doc, when present, carries the artist's own words + curated story
  // hooks — highest-quality About material we have.
  const artistDoc = await getArtistDoc(artistId);
  if (artistDoc?.content) {
    promptParts.push(`\n--- ARTIST DOC (compiled with the artist during onboarding; interview quotes are their own words — quote, don't paraphrase) ---\n${artistDoc.content.slice(0, ARTIST_DOC_CONTEXT_CAP)}\n--- END ARTIST DOC ---`);
  }
```

- [ ] **Step 4: Run tests to verify they pass, plus surrounding suites**

Run: `npx jest src/app/api/askArtist src/app/api/funFacts src/server/utils/queries`
Expected: PASS (new test green, no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/askArtist/route.ts "src/app/api/funFacts/[type]/route.ts" src/server/utils/queries/artistBioQuery.ts src/app/api/askArtist/__tests__/docInjection.test.ts
git commit -m "feat(onboarding): inject artist doc into askArtist, fun facts, and bio synthesis"
```

---

### Task 7: The turn engine (forced chain handlers)

**Files:**
- Create: `src/server/utils/onboarding/questions.ts`
- Create: `src/server/utils/onboarding/turnHandlers.ts`
- Test: `src/server/utils/onboarding/__tests__/turnHandlers.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 & 5; `setArtistLink`, `clearArtistLink` from `@/server/utils/artistLinkService`; `extractArtistId` from `@/server/utils/services` (returns `{ siteName, cardPlatformName, id } | undefined`); `getVaultSourcesByArtistId`, `getVaultSourceByIdAndArtist`, `updateVaultSourceStatus`, `saveBioVersion` from dashboardQueries; `musicPlatformData` from `@/server/utils/musicPlatform`.
- Produces (Task 8 and the client rely on these exact shapes):

```ts
export type TurnEvent =
  | { kind: "chat"; text: string }
  | { kind: "progress"; label: string; done: boolean }
  | { kind: "step"; step: OnboardingStep; payload: unknown }
  | { kind: "draft"; doc: string; about: string }
  | { kind: "complete" }
  | { kind: "error"; message: string };

export type ClientTurn =
  | { type: "open" }
  | { type: "confirm_profiles"; addedLinks: { url: string }[]; removedSiteNames: string[] }
  | { type: "vault_review"; decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }
  | { type: "interview_answer"; questionKey: string; answer: string | null }
  | { type: "publish"; doc: string; about: string };

export async function* runOnboardingTurn(artistId: string, turn: ClientTurn): AsyncGenerator<TurnEvent>;
```

Step payloads: `profiles` → `{ artistName: string; links: { siteName: string; value: string }[]; enrichment: { platform: string; followerCount: number | null; imageUrl: string | null } | null }`; `vault` → `{ sources: { id: string; title: string | null; url: string; snippet: string | null }[] }`; `interview` → `{ questionKey: string; question: string; number: number; total: number }`.

- [ ] **Step 1: Create `src/server/utils/onboarding/questions.ts`:**

```ts
/** The onboarding interview: exactly three questions, all skippable (~90 seconds).
 *  Skipped questions return to the future follow-up bank (spec §6). */
export const ONBOARDING_QUESTIONS = [
    { key: "sound_in_own_words", question: "How would you describe your sound, in your own words?" },
    { key: "offline_fact", question: "What's something fans should know about you that isn't written anywhere online?" },
    { key: "working_on_now", question: "What are you working on right now?" },
] as const;

export type OnboardingQuestionKey = (typeof ONBOARDING_QUESTIONS)[number]["key"];
```

- [ ] **Step 2: Write the failing tests** — `src/server/utils/onboarding/__tests__/turnHandlers.test.ts`:

```ts
// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/onboardingQueries', () => ({
    ONBOARDING_STEPS: ['profiles', 'vault', 'interview', 'publish'],
    getOnboardingState: jest.fn(),
    confirmOnboardingStep: jest.fn().mockResolvedValue(undefined),
    getInterviewAnswers: jest.fn().mockResolvedValue([]),
    upsertInterviewAnswer: jest.fn().mockResolvedValue(undefined),
    upsertArtistDoc: jest.fn().mockResolvedValue(undefined),
    getArtistDoc: jest.fn(),
}));
jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn().mockResolvedValue({ id: 'a1', name: 'Nova Reyes', spotify: 'spot1', instagram: 'nova' }) }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
    getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]),
    getVaultSourceByIdAndArtist: jest.fn(),
    updateVaultSourceStatus: jest.fn().mockResolvedValue({}),
    saveBioVersion: jest.fn().mockResolvedValue({}),
    insertVaultSource: jest.fn().mockResolvedValue({ id: 'new-src' }),
}));
jest.mock('@/server/utils/queries/vaultWebSearch', () => ({ searchAndPopulateVault: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/fetchPageContent', () => ({ isUnsafeUrl: jest.fn().mockReturnValue(false) }));
jest.mock('@/lib/sourceTypes', () => ({ inferTypeFromUrl: jest.fn().mockReturnValue('article') }));
jest.mock('@/server/utils/artistLinkService', () => ({ setArtistLink: jest.fn().mockResolvedValue({ oldValue: null, artistName: 'Nova' }), clearArtistLink: jest.fn().mockResolvedValue({ oldValue: 'x' }) }));
jest.mock('@/server/utils/services', () => ({ extractArtistId: jest.fn() }));
jest.mock('@/server/utils/artistDocService', () => ({
    ARTIST_DOC_MAX_CHARS: 20000,
    synthesizeArtistDoc: jest.fn().mockResolvedValue('## Overview\ndoc'),
    generateAboutFromDoc: jest.fn().mockResolvedValue('An About.'),
}));

async function collect(gen) {
    const events = [];
    for await (const e of gen) events.push(e);
    return events;
}

describe('runOnboardingTurn', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    it('open resumes at the derived current step (vault here), never at a fixed start', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'vault' });
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'open' }));
        expect(events.find(e => e.kind === 'step')?.step).toBe('vault');
    });

    it('confirm_profiles writes added links via extractArtistId and reports bad URLs politely', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const { extractArtistId } = await import('@/server/utils/services');
        const { setArtistLink } = await import('@/server/utils/artistLinkService');
        extractArtistId
            .mockResolvedValueOnce({ siteName: 'tiktok', cardPlatformName: 'TikTok', id: 'novareyes' })
            .mockResolvedValueOnce(undefined); // unrecognized URL
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', {
            type: 'confirm_profiles',
            addedLinks: [{ url: 'https://tiktok.com/@novareyes' }, { url: 'https://nonsense.example/xyz' }],
            removedSiteNames: [],
        }));
        expect(setArtistLink).toHaveBeenCalledWith('a1', 'tiktok', 'novareyes');
        expect(oq.confirmOnboardingStep).toHaveBeenCalledWith('a1', 'profiles');
        expect(events.some(e => e.kind === 'chat' && e.text.includes("couldn't recognize"))).toBe(true);
        expect(events.some(e => e.kind === 'error')).toBe(false); // degradation, not failure
    });

    it('vault_review only updates sources belonging to this artist', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'vault' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        dq.getVaultSourceByIdAndArtist
            .mockResolvedValueOnce({ id: 's1', artistId: 'a1' })
            .mockResolvedValueOnce(undefined); // someone else's source id
        const { runOnboardingTurn } = await import('../turnHandlers');
        await collect(runOnboardingTurn('a1', {
            type: 'vault_review',
            decisions: [{ sourceId: 's1', status: 'approved' }, { sourceId: 'evil', status: 'approved' }],
        }));
        expect(dq.updateVaultSourceStatus).toHaveBeenCalledTimes(1);
        expect(dq.updateVaultSourceStatus).toHaveBeenCalledWith('s1', 'approved');
    });

    it('interview_answer stores the answer, then asks the next unanswered question; last answer confirms the step and enters publish (draft generated)', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'interview' });
        oq.getInterviewAnswers.mockResolvedValue([
            { questionKey: 'sound_in_own_words', answer: 'a' },
            { questionKey: 'offline_fact', answer: null },
            { questionKey: 'working_on_now', answer: 'b' },
        ]); // all three asked → step complete
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', {
            type: 'interview_answer', questionKey: 'working_on_now', answer: 'new album',
        }));
        expect(oq.upsertInterviewAnswer).toHaveBeenCalledWith(expect.objectContaining({
            artistId: 'a1', questionKey: 'working_on_now', answer: 'new album', source: 'onboarding',
        }));
        expect(oq.confirmOnboardingStep).toHaveBeenCalledWith('a1', 'interview');
        expect(events.some(e => e.kind === 'draft' && e.doc && e.about)).toBe(true);
    });

    it('publish validates caps, persists doc + bio version + artists.bio, confirms publish, completes', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'publish' });
        const dq = await import('@/server/utils/queries/dashboardQueries');
        const { db } = await import('@/server/db/drizzle');
        db.update.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) });
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'publish', doc: '## Overview\nd', about: 'About text' }));
        expect(oq.upsertArtistDoc).toHaveBeenCalledWith('a1', '## Overview\nd');
        expect(dq.saveBioVersion).toHaveBeenCalledWith('a1', 'About text');
        expect(oq.confirmOnboardingStep).toHaveBeenCalledWith('a1', 'publish');
        expect(events.some(e => e.kind === 'complete')).toBe(true);
    });

    it('publish rejects when not on the publish step', async () => {
        const oq = await import('@/server/utils/queries/onboardingQueries');
        oq.getOnboardingState.mockResolvedValue({ complete: false, currentStep: 'profiles' });
        const { runOnboardingTurn } = await import('../turnHandlers');
        const events = await collect(runOnboardingTurn('a1', { type: 'publish', doc: 'd', about: 'a' }));
        expect(events.some(e => e.kind === 'error')).toBe(true);
        expect(oq.upsertArtistDoc).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/server/utils/onboarding/__tests__/turnHandlers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/server/utils/onboarding/turnHandlers.ts`:**

```ts
/**
 * The forced onboarding chain. The SERVER owns the step sequence; the model
 * never decides what happens next. Every handler is idempotent — a re-run
 * after a disconnect upserts the same state and continues (spec §6, §9).
 */
import { db } from "@/server/db/drizzle";
import { eq } from "drizzle-orm";
import { artists } from "@/server/db/schema";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import {
    getVaultSourcesByArtistId,
    getVaultSourceByIdAndArtist,
    updateVaultSourceStatus,
    saveBioVersion,
    insertVaultSource,
} from "@/server/utils/queries/dashboardQueries";
import { searchAndPopulateVault } from "@/server/utils/queries/vaultWebSearch";
import { isUnsafeUrl } from "@/server/utils/fetchPageContent";
import { inferTypeFromUrl } from "@/lib/sourceTypes";
import {
    type OnboardingStep,
    getOnboardingState,
    confirmOnboardingStep,
    getInterviewAnswers,
    upsertInterviewAnswer,
    upsertArtistDoc,
} from "@/server/utils/queries/onboardingQueries";
import { setArtistLink, clearArtistLink } from "@/server/utils/artistLinkService";
import { extractArtistId } from "@/server/utils/services";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import { synthesizeArtistDoc, generateAboutFromDoc, ARTIST_DOC_MAX_CHARS } from "@/server/utils/artistDocService";
import { ONBOARDING_QUESTIONS } from "./questions";
import { MAX_BIO_LENGTH } from "@/lib/bioConstants";
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";

export type TurnEvent =
    | { kind: "chat"; text: string }
    | { kind: "progress"; label: string; done: boolean }
    | { kind: "step"; step: OnboardingStep; payload: unknown }
    | { kind: "draft"; doc: string; about: string }
    | { kind: "complete" }
    | { kind: "error"; message: string };

export type ClientTurn =
    | { type: "open" }
    | { type: "confirm_profiles"; addedLinks: { url: string }[]; removedSiteNames: string[] }
    | { type: "vault_review"; decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }
    | { type: "interview_answer"; questionKey: string; answer: string | null }
    | { type: "publish"; doc: string; about: string };

// Link columns surfaced as profile cards (display subset of the writable whitelist).
const PROFILE_DISPLAY_COLUMNS = [
    "spotify", "deezer", "instagram", "tiktok", "x", "youtube",
    "soundcloud", "bandcamp", "twitch", "facebook",
] as const;

const NARRATION = {
    welcome: "Welcome! Your profile is officially yours — let's get it into shape. This takes about two minutes, and you can pick it back up anytime.",
    welcomeBack: "Welcome back — picking up right where you left off.",
    alreadyDone: "You're all set — your profile is published. You can edit anything from your page whenever you like.",
    profiles: "First: here's everything we have linked to you. Leaving a card as-is confirms it — remove anything that isn't you, or paste a link we missed.",
    profilesDone: "Profiles confirmed. Now let's look at what the internet says about you.",
    vault: "We found these sources about you. Keep what's accurate — they feed your About page and the AI that answers fan questions.",
    vaultEmpty: "We didn't find much about you on the web yet — no problem. Paste a link to press, an interview, or your own site below, or just continue.",
    vaultDone: "Sources sorted. Now the fun part — three quick questions. Skip any of them.",
    generating: "Okay, I have everything I need. Watch this — I'm writing your About page from your links, your sources, and your own words.",
    draftReady: "There it is. Publish it as-is, or copy it out and tweak — your call.",
    published: "You're live! 🎉 Your About is published, and everything you shared is saved as your artist doc — it now powers your page's Q&A and fun facts too.",
} as const;

/** One warm Gemini sentence reacting to an interview answer. Bounded at 5s;
 *  any failure falls back to a template — the ack is garnish, never a blocker. */
async function generateInterviewAck(question: string, answer: string): Promise<string> {
    const FALLBACK = "Love that — noted, in your words.";
    try {
        const response = await Promise.race([
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `The artist was asked: "${question}" and answered: "${answer}". Reply with ONE short, warm, specific sentence reacting to their answer. No questions, no emoji, no hype words.`,
                config: { temperature: 0.7 },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ack timeout")), 5000)),
        ]);
        return response.text?.trim() || FALLBACK;
    } catch {
        return FALLBACK;
    }
}

async function buildProfilesPayload(artistId: string) {
    const artist = await getArtistById(artistId);
    if (!artist) throw new Error(`Artist not found: ${artistId}`);
    const record = artist as unknown as Record<string, unknown>;
    const links = PROFILE_DISPLAY_COLUMNS.flatMap(col => {
        const value = record[col];
        return typeof value === "string" && value ? [{ siteName: col, value }] : [];
    });
    const enrichment = await musicPlatformData.getArtist(artist).catch(() => null);
    return {
        artistName: artist.name ?? "your profile",
        links,
        enrichment: enrichment
            ? { platform: enrichment.platform, followerCount: enrichment.followerCount, imageUrl: enrichment.imageUrl }
            : null,
    };
}

/** Emit the entry payload for a step. The interview case advances itself when done. */
async function* emitStep(artistId: string, step: OnboardingStep): AsyncGenerator<TurnEvent> {
    switch (step) {
        case "profiles": {
            yield { kind: "progress", label: "Gathering your profiles", done: false };
            const payload = await buildProfilesPayload(artistId);
            yield { kind: "progress", label: "Gathering your profiles", done: true };
            yield { kind: "chat", text: NARRATION.profiles };
            yield { kind: "step", step: "profiles", payload };
            return;
        }
        case "vault": {
            let pending = await getVaultSourcesByArtistId(artistId, "pending");
            if (pending.length === 0) {
                // Approval-time discovery may have found nothing or still be running.
                // Re-run ONLY when the vault is entirely empty (spec §4). Bounded
                // ~38s inside the route's 55s deadline; failure degrades gracefully.
                const approved = await getVaultSourcesByArtistId(artistId, "approved");
                if (approved.length === 0) {
                    yield { kind: "progress", label: "Searching the web for sources about you", done: false };
                    try {
                        await searchAndPopulateVault(artistId);
                        pending = await getVaultSourcesByArtistId(artistId, "pending");
                    } catch (e) {
                        console.error("[onboarding] vault discovery failed:", e);
                    }
                    yield { kind: "progress", label: "Searching the web for sources about you", done: true };
                }
            }
            yield { kind: "chat", text: pending.length > 0 ? NARRATION.vault : NARRATION.vaultEmpty };
            yield {
                kind: "step",
                step: "vault",
                payload: { sources: pending.map(s => ({ id: s.id, title: s.title, url: s.url, snippet: s.snippet })) },
            };
            return;
        }
        case "interview": {
            const asked = new Set((await getInterviewAnswers(artistId)).map(a => a.questionKey));
            const nextIndex = ONBOARDING_QUESTIONS.findIndex(q => !asked.has(q.key));
            if (nextIndex === -1) {
                await confirmOnboardingStep(artistId, "interview");
                yield* emitStep(artistId, "publish");
                return;
            }
            const next = ONBOARDING_QUESTIONS[nextIndex];
            yield { kind: "chat", text: next.question };
            yield {
                kind: "step",
                step: "interview",
                payload: { questionKey: next.key, question: next.question, number: nextIndex + 1, total: ONBOARDING_QUESTIONS.length },
            };
            return;
        }
        case "publish": {
            yield { kind: "chat", text: NARRATION.generating };
            yield { kind: "progress", label: "Reading your sources and answers", done: false };
            // Gemini failure policy: apologize in-stream, retry ONCE, else let the
            // throw reach the route (error event; checkpoint stays unmet — spec §9).
            let doc: string;
            try {
                doc = await synthesizeArtistDoc(artistId);
            } catch {
                yield { kind: "chat", text: "Hmm, that didn't come together — give me one more second." };
                doc = await synthesizeArtistDoc(artistId);
            }
            yield { kind: "progress", label: "Reading your sources and answers", done: true };
            yield { kind: "progress", label: "Writing your About", done: false };
            const artist = await getArtistById(artistId);
            let about: string;
            try {
                about = await generateAboutFromDoc(artist?.name ?? "this artist", doc);
            } catch {
                yield { kind: "chat", text: "One more try on the wording…" };
                about = await generateAboutFromDoc(artist?.name ?? "this artist", doc);
            }
            yield { kind: "progress", label: "Writing your About", done: true };
            // Turns are stateless: the draft round-trips through the client and
            // comes back in the publish turn (spec §6, advisor FIX 1).
            yield { kind: "draft", doc, about };
            yield { kind: "chat", text: NARRATION.draftReady };
            return;
        }
    }
}

export async function* runOnboardingTurn(artistId: string, turn: ClientTurn): AsyncGenerator<TurnEvent> {
    const state = await getOnboardingState(artistId);

    if (turn.type === "open") {
        if (state.complete || state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        yield { kind: "chat", text: state.currentStep === "profiles" ? NARRATION.welcome : NARRATION.welcomeBack };
        yield* emitStep(artistId, state.currentStep);
        return;
    }

    if (turn.type === "confirm_profiles") {
        const failures: string[] = [];
        for (const siteName of turn.removedSiteNames ?? []) {
            try {
                await clearArtistLink(artistId, siteName);
            } catch (e) {
                console.error(`[onboarding] clearArtistLink failed for ${siteName}:`, e);
            }
        }
        for (const raw of turn.addedLinks ?? []) {
            try {
                const extracted = await extractArtistId(raw.url);
                if (!extracted?.siteName || !extracted?.id) {
                    failures.push(raw.url);
                    continue;
                }
                await setArtistLink(artistId, extracted.siteName, extracted.id);
            } catch (e) {
                console.error(`[onboarding] setArtistLink failed for ${raw.url}:`, e);
                failures.push(raw.url);
            }
        }
        await confirmOnboardingStep(artistId, "profiles");
        if (failures.length > 0) {
            yield {
                kind: "chat",
                text: `Heads up — I couldn't recognize ${failures.length === 1 ? "one of your links" : `${failures.length} of your links`}. You can add ${failures.length === 1 ? "it" : "them"} anytime from the Social Links section of your page.`,
            };
        }
        yield { kind: "chat", text: NARRATION.profilesDone };
        yield* emitStep(artistId, "vault");
        return;
    }

    if (turn.type === "vault_review") {
        for (const decision of turn.decisions ?? []) {
            // Ownership: only touch sources that belong to THIS artist.
            const source = await getVaultSourceByIdAndArtist(decision.sourceId, artistId);
            if (!source) continue;
            await updateVaultSourceStatus(decision.sourceId, decision.status);
        }
        // Artist-pasted links go straight to approved — they added them themselves.
        for (const url of turn.addedUrls ?? []) {
            try {
                if (isUnsafeUrl(url)) continue;
                await insertVaultSource({ artistId, url, type: inferTypeFromUrl(url), status: "approved" });
            } catch (e) {
                console.error(`[onboarding] insertVaultSource failed for ${url}:`, e);
            }
        }
        await confirmOnboardingStep(artistId, "vault");
        yield { kind: "chat", text: NARRATION.vaultDone };
        yield* emitStep(artistId, "interview");
        return;
    }

    if (turn.type === "interview_answer") {
        const question = ONBOARDING_QUESTIONS.find(q => q.key === turn.questionKey);
        if (!question) {
            yield { kind: "error", message: "Unknown question — let's continue from where we were." };
            yield* emitStep(artistId, state.currentStep ?? "interview");
            return;
        }
        const answer = turn.answer?.trim() || null;
        await upsertInterviewAnswer({
            artistId,
            questionKey: question.key,
            question: question.question,
            answer,
            source: "onboarding",
        });
        if (answer) {
            yield { kind: "chat", text: await generateInterviewAck(question.question, answer) };
        }
        // On resume, ask the first question lacking a row — answered or skipped
        // questions are never re-asked (spec §6). emitStep handles completion.
        yield* emitStep(artistId, "interview");
        return;
    }

    if (turn.type === "publish") {
        if (state.currentStep !== "publish") {
            yield { kind: "error", message: "We're not quite there yet — let's finish the earlier steps first." };
            if (state.currentStep) yield* emitStep(artistId, state.currentStep);
            return;
        }
        const doc = turn.doc?.trim();
        const about = turn.about?.trim();
        if (!doc || doc.length > ARTIST_DOC_MAX_CHARS) {
            yield { kind: "error", message: "That doc looks off — let me regenerate it." };
            yield* emitStep(artistId, "publish");
            return;
        }
        if (!about || about.length > MAX_BIO_LENGTH) {
            yield { kind: "error", message: "That About looks off — let me regenerate it." };
            yield* emitStep(artistId, "publish");
            return;
        }
        await upsertArtistDoc(artistId, doc);
        await saveBioVersion(artistId, about);
        // The ONLY implicit artists.bio write in this feature — the explicit
        // publish moment (spec §6). Later doc regens never touch the bio.
        await db.update(artists).set({ bio: about }).where(eq(artists.id, artistId));
        await confirmOnboardingStep(artistId, "publish");
        yield { kind: "chat", text: NARRATION.published };
        yield { kind: "complete" };
        return;
    }

    yield { kind: "error", message: "I didn't understand that — let's continue." };
    if (state.currentStep) yield* emitStep(artistId, state.currentStep);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/server/utils/onboarding/__tests__/turnHandlers.test.ts`
Expected: PASS (all 6).

- [ ] **Step 6: Commit**

```bash
git add src/server/utils/onboarding/
git commit -m "feat(onboarding): forced-chain turn engine with derived resume and idempotent handlers"
```

---

### Task 8: SSE chat route

**Files:**
- Create: `src/app/api/onboarding/[artistId]/chat/route.ts`
- Test: `src/app/api/onboarding/[artistId]/chat/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `runOnboardingTurn`, `ClientTurn` from Task 7; `getServerAuthSession` from `@/server/auth`; `getDevSession` from `@/server/utils/dev-auth`; `canEditArtist` from `@/server/utils/artistEditAuth`.
- Produces: `POST /api/onboarding/[artistId]/chat` — body is a `ClientTurn` JSON; response is `text/event-stream` where each event is `data: <JSON TurnEvent>\n\n`. Errors: 401 (no session), 403 (not claimant/admin), 400 (bad body). The client hook (Task 9) parses exactly this.

- [ ] **Step 1: Write the failing tests** — `src/app/api/onboarding/[artistId]/chat/__tests__/route.test.ts`:

```ts
// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn().mockResolvedValue(null) }));
jest.mock('@/server/utils/artistEditAuth', () => ({ canEditArtist: jest.fn() }));
jest.mock('@/server/utils/onboarding/turnHandlers', () => ({
    runOnboardingTurn: jest.fn(),
}));

if (!('json' in Response)) {
    Response.json = (data, init) =>
        new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            status: init?.status || 200,
        });
}

async function readAll(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value);
    }
    return out;
}

const params = { params: Promise.resolve({ artistId: 'a1' }) };
const makeReq = (body) => new Request('http://x/api/onboarding/a1/chat', { method: 'POST', body: JSON.stringify(body) });

describe('POST /api/onboarding/[artistId]/chat', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ session = { user: { id: 'u1' } }, canEdit = true } = {}) {
        const { getServerAuthSession } = await import('@/server/auth');
        const { canEditArtist } = await import('@/server/utils/artistEditAuth');
        const { runOnboardingTurn } = await import('@/server/utils/onboarding/turnHandlers');
        getServerAuthSession.mockResolvedValue(session);
        canEditArtist.mockResolvedValue(canEdit);
        runOnboardingTurn.mockImplementation(async function* () {
            yield { kind: 'chat', text: 'hello' };
            yield { kind: 'complete' };
        });
        const { POST } = await import('../route');
        return { POST, canEditArtist, runOnboardingTurn };
    }

    it('401s with no session', async () => {
        const { POST } = await setup({ session: null });
        const res = await POST(makeReq({ type: 'open' }), params);
        expect(res.status).toBe(401);
    });

    it('403s when the user cannot edit this artist', async () => {
        const { POST } = await setup({ canEdit: false });
        const res = await POST(makeReq({ type: 'open' }), params);
        expect(res.status).toBe(403);
    });

    it('400s on a body without a type', async () => {
        const { POST } = await setup();
        const res = await POST(makeReq({ nope: true }), params);
        expect(res.status).toBe(400);
    });

    it('streams turn events as SSE data lines', async () => {
        const { POST } = await setup();
        const res = await POST(makeReq({ type: 'open' }), params);
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
        const text = await readAll(res);
        expect(text).toContain('data: {"kind":"chat","text":"hello"}');
        expect(text).toContain('data: {"kind":"complete"}');
    });

    it('converts a thrown handler error into an error event, not a crash', async () => {
        const { POST, runOnboardingTurn } = await setup();
        runOnboardingTurn.mockImplementation(async function* () {
            yield { kind: 'chat', text: 'partial' };
            throw new Error('boom');
        });
        const res = await POST(makeReq({ type: 'open' }), params);
        const text = await readAll(res);
        expect(text).toContain('"kind":"error"');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest "src/app/api/onboarding/[artistId]/chat/__tests__/route.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/onboarding/[artistId]/chat/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import { runOnboardingTurn, type ClientTurn } from "@/server/utils/onboarding/turnHandlers";

export const dynamic = "force-dynamic";
// One POST = ONE chat turn (spec §4). The publish-step generation turn runs two
// ungrounded Gemini calls (~8s each measured on artistBio) — comfortably inside
// 60s, but the deadline below guarantees we close before Vercel kills us.
export const maxDuration = 60;
const TURN_DEADLINE_MS = 55_000;

export async function POST(request: Request, { params }: { params: Promise<{ artistId: string }> }) {
    const { artistId } = await params;

    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!(await canEditArtist(session.user.id, artistId))) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    let turn: ClientTurn;
    try {
        turn = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    if (!turn || typeof turn !== "object" || typeof (turn as { type?: unknown }).type !== "string") {
        return NextResponse.json({ error: "Invalid turn" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const startedAt = Date.now();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: unknown) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            try {
                for await (const event of runOnboardingTurn(artistId, turn)) {
                    send(event);
                    if (Date.now() - startedAt > TURN_DEADLINE_MS) {
                        // Checkpoint stays unconfirmed — derived state resumes next turn (spec §9).
                        send({ kind: "error", message: "That took longer than expected — you can pick up right where you left off." });
                        break;
                    }
                }
            } catch (e) {
                console.error("[onboarding/chat] Turn error:", e);
                send({ kind: "error", message: "Something went wrong on our end — try that again." });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest "src/app/api/onboarding/[artistId]/chat/__tests__/route.test.ts"`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/onboarding/"
git commit -m "feat(onboarding): per-turn SSE chat route with claimant auth and 55s deadline"
```

---

### Task 9: Client foundation — SSE hook, gate, banner, page wiring

**Files:**
- Create: `src/app/artist/[id]/_components/onboarding/useOnboardingChat.ts`
- Create: `src/app/artist/[id]/_components/onboarding/OnboardingGate.tsx`
- Create: `src/app/artist/[id]/_components/onboarding/OnboardingBanner.tsx`
- Modify: `src/app/artist/[id]/page.tsx` (import; state fetch after line 101; render after line 111)
- Test: `src/app/artist/[id]/_components/onboarding/__tests__/OnboardingGate.test.tsx`

**Interfaces:**
- Consumes: route contract from Task 8; `OnboardingStep`/`getOnboardingState` from Task 2.
- Produces:
  - `useOnboardingChat(artistId: string): { items: ChatItem[]; busy: boolean; sendTurn: (turn: ClientTurnShape) => Promise<void> }` where `ChatItem = { id: string; kind: "bot" | "user" | "progress" | "step" | "draft" | "complete" | "error"; text?: string; step?: string; payload?: unknown; doc?: string; about?: string; done?: boolean }` (turn shapes mirror Task 7's `ClientTurn`; the hook appends a `user` item itself for user-visible turns)
  - `<OnboardingGate artistId artistName currentStep />` — client component; decides takeover-vs-banner from `sessionStorage` (the server cannot see the skip flag — spec §8)
  - `skipFlagKey(artistId: string): string` returning `` `mn-onboarding-skip-${artistId}` ``
  - Task 10 renders inside the gate via `<OnboardingChat artistId artistName onSkip={...} />` (built next task; gate ships first with a placeholder import guarded behind the same file path).

Note: Task 9 and Task 10 are one PR-sized unit split for review; the gate imports `OnboardingChat` from `./OnboardingChat`, which Task 10 creates. To keep Task 9 independently green, Step 4 creates a minimal `OnboardingChat.tsx` stub that Task 10 replaces wholesale.

- [ ] **Step 1: Write the failing tests** — `src/app/artist/[id]/_components/onboarding/__tests__/OnboardingGate.test.tsx`:

```tsx
// @ts-nocheck
import { jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import OnboardingGate, { skipFlagKey } from '../OnboardingGate';

jest.mock('../OnboardingChat', () => ({
    __esModule: true,
    default: ({ onSkip }) => <div data-testid="onboarding-chat"><button onClick={onSkip}>skip</button></div>,
}));

describe('OnboardingGate', () => {
    beforeEach(() => sessionStorage.clear());

    it('opens the chat takeover when there is no skip flag', () => {
        render(<OnboardingGate artistId="a1" artistName="Nova Reyes" currentStep="profiles" />);
        expect(screen.getByTestId('onboarding-chat')).toBeInTheDocument();
    });

    it('shows the banner instead when the session skip flag is set', () => {
        sessionStorage.setItem(skipFlagKey('a1'), '1');
        render(<OnboardingGate artistId="a1" artistName="Nova Reyes" currentStep="vault" />);
        expect(screen.queryByTestId('onboarding-chat')).not.toBeInTheDocument();
        expect(screen.getByText(/finish setting up/i)).toBeInTheDocument();
    });

    it('skipping sets the flag and swaps to the banner; banner CTA reopens the chat', () => {
        render(<OnboardingGate artistId="a1" artistName="Nova Reyes" currentStep="profiles" />);
        fireEvent.click(screen.getByText('skip'));
        expect(sessionStorage.getItem(skipFlagKey('a1'))).toBe('1');
        expect(screen.getByText(/finish setting up/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
        expect(screen.getByTestId('onboarding-chat')).toBeInTheDocument();
    });

    it('banner copy frames the next step as the next win (never shame)', () => {
        sessionStorage.setItem(skipFlagKey('a1'), '1');
        render(<OnboardingGate artistId="a1" artistName="Nova Reyes" currentStep="interview" />);
        expect(screen.getByText(/tell us your story/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest "src/app/artist/[id]/_components/onboarding/__tests__/OnboardingGate.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useOnboardingChat.ts`:**

```ts
"use client";

import { useCallback, useRef, useState } from "react";

export type ChatItem = {
    id: string;
    kind: "bot" | "user" | "progress" | "step" | "draft" | "complete" | "error";
    text?: string;
    step?: string;
    payload?: unknown;
    doc?: string;
    about?: string;
    done?: boolean;
};

export type ClientTurnShape =
    | { type: "open" }
    | { type: "confirm_profiles"; addedLinks: { url: string }[]; removedSiteNames: string[] }
    | { type: "vault_review"; decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }
    | { type: "interview_answer"; questionKey: string; answer: string | null }
    | { type: "publish"; doc: string; about: string };

/** Text shown as the user's own bubble for a given turn (null = no user bubble). */
function userEcho(turn: ClientTurnShape): string | null {
    switch (turn.type) {
        case "confirm_profiles": return "Looks good — that's me.";
        case "vault_review": return "Done sorting those.";
        case "interview_answer": return turn.answer ?? "Skip that one.";
        case "publish": return "Publish it 🚀";
        default: return null;
    }
}

export function useOnboardingChat(artistId: string) {
    const [items, setItems] = useState<ChatItem[]>([]);
    const [busy, setBusy] = useState(false);
    const counter = useRef(0);

    const push = useCallback((item: Omit<ChatItem, "id">) => {
        counter.current += 1;
        const id = `c${counter.current}`;
        setItems(prev => {
            // progress events update their existing chip in place (label match)
            if (item.kind === "progress") {
                const idx = prev.findIndex(p => p.kind === "progress" && p.text === item.text);
                if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = { ...next[idx], done: item.done };
                    return next;
                }
            }
            return [...prev, { id, ...item }];
        });
    }, []);

    const sendTurn = useCallback(async (turn: ClientTurnShape) => {
        if (busy) return;
        setBusy(true);
        const echo = userEcho(turn);
        if (echo) push({ kind: "user", text: echo });
        try {
            const res = await fetch(`/api/onboarding/${artistId}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(turn),
            });
            if (!res.ok || !res.body) {
                // Non-SSE failure (401/403/429/500) comes back as JSON
                const data = await res.json().catch(() => null);
                push({ kind: "error", text: data?.error ?? "Something went wrong — try again in a moment." });
                return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let sep: number;
                while ((sep = buffer.indexOf("\n\n")) !== -1) {
                    const line = buffer.slice(0, sep).trim();
                    buffer = buffer.slice(sep + 2);
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        switch (event.kind) {
                            case "chat": push({ kind: "bot", text: event.text }); break;
                            case "progress": push({ kind: "progress", text: event.label, done: event.done }); break;
                            case "step": push({ kind: "step", step: event.step, payload: event.payload }); break;
                            case "draft": push({ kind: "draft", doc: event.doc, about: event.about }); break;
                            case "complete": push({ kind: "complete" }); break;
                            case "error": push({ kind: "error", text: event.message }); break;
                        }
                    } catch {
                        // malformed line — skip
                    }
                }
            }
        } catch (e) {
            console.error("[useOnboardingChat] stream error:", e);
            push({ kind: "error", text: "Connection dropped — your progress is saved, just try again." });
        } finally {
            setBusy(false);
        }
    }, [artistId, busy, push]);

    return { items, busy, sendTurn };
}
```

- [ ] **Step 4: Implement `OnboardingGate.tsx`, `OnboardingBanner.tsx`, and the Task-10 stub.**

`OnboardingGate.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import OnboardingChat from "./OnboardingChat";
import OnboardingBanner from "./OnboardingBanner";

export function skipFlagKey(artistId: string): string {
    return `mn-onboarding-skip-${artistId}`;
}

type Props = {
    artistId: string;
    artistName: string;
    currentStep: string | null;
};

/**
 * Client-side takeover-vs-banner branch. The server only reports onboarding
 * state; the skip flag lives in sessionStorage and is invisible to the server
 * component (spec §8). Skip is session-scoped: a later visit reopens the chat.
 */
export default function OnboardingGate({ artistId, artistName, currentStep }: Props) {
    // Start closed and decide after mount — sessionStorage is unavailable during SSR.
    const [mode, setMode] = useState<"closed" | "chat" | "banner">("closed");

    useEffect(() => {
        const skipped = sessionStorage.getItem(skipFlagKey(artistId)) === "1";
        setMode(skipped ? "banner" : "chat");
    }, [artistId]);

    if (mode === "closed") return null;
    if (mode === "chat") {
        return (
            <OnboardingChat
                artistId={artistId}
                artistName={artistName}
                onSkip={() => {
                    sessionStorage.setItem(skipFlagKey(artistId), "1");
                    setMode("banner");
                }}
            />
        );
    }
    return (
        <OnboardingBanner
            currentStep={currentStep}
            onContinue={() => {
                sessionStorage.removeItem(skipFlagKey(artistId));
                setMode("chat");
            }}
        />
    );
}
```

`OnboardingBanner.tsx`:

```tsx
"use client";

// One next step per visit, framed as the next win — never as incompleteness.
const STEP_LABELS: Record<string, string> = {
    profiles: "Next up: confirm your profiles",
    vault: "Next up: pick your best sources",
    interview: "Next up: tell us your story",
    publish: "One tap left: publish your About",
};

type Props = {
    currentStep: string | null;
    onContinue: () => void;
};

export default function OnboardingBanner({ currentStep, onContinue }: Props) {
    const label = (currentStep && STEP_LABELS[currentStep]) ?? "Next up: confirm your profiles";
    return (
        <div className="glass flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl">
            <div>
                <p className="text-black dark:text-white font-semibold">Finish setting up your profile</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{label} — about a minute.</p>
            </div>
            <button
                onClick={onContinue}
                className="bg-pink-500 hover:bg-pink-600 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
            >
                Continue →
            </button>
        </div>
    );
}
```

`OnboardingChat.tsx` (temporary stub — Task 10 replaces this file wholesale):

```tsx
"use client";

type Props = { artistId: string; artistName: string; onSkip: () => void };

export default function OnboardingChat({ onSkip }: Props) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="glass p-6 rounded-2xl">
                <p className="text-black dark:text-white">Onboarding chat coming in the next task.</p>
                <button onClick={onSkip} className="mt-3 text-sm text-gray-500 underline">Skip for now</button>
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest "src/app/artist/[id]/_components/onboarding/__tests__/OnboardingGate.test.tsx"`
Expected: PASS (all 4).

- [ ] **Step 6: Wire the artist page.** In `src/app/artist/[id]/page.tsx`:

Add imports:

```ts
import OnboardingGate from "./_components/onboarding/OnboardingGate";
import { getOnboardingState } from "@/server/utils/queries/onboardingQueries";
```

After the `autoApproveLinkSubmissions` line (~101), add — gated so public visitors pay zero extra queries:

```ts
    // Onboarding state costs a query — computed ONLY for the approved claimant.
    const onboardingState = isClaimedByUser ? await getOnboardingState(id) : null;
```

Inside the returned JSX, immediately after the opening `<div className="w-full max-w-[800px] ...">` (before the HeroSection comment), add:

```tsx
                {onboardingState && !onboardingState.complete && (
                    <OnboardingGate
                        artistId={artist.id}
                        artistName={artist.name ?? "your profile"}
                        currentStep={onboardingState.currentStep}
                    />
                )}
```

- [ ] **Step 7: Type-check + full test run**

Run: `npm run type-check && npx jest "src/app/artist"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/artist/[id]/_components/onboarding/" "src/app/artist/[id]/page.tsx"
git commit -m "feat(onboarding): client gate, session-scoped skip, banner, and artist-page wiring"
```

---

### Task 10: Chat surface + step cards

**Files:**
- Replace: `src/app/artist/[id]/_components/onboarding/OnboardingChat.tsx` (the Task 9 stub, wholesale)
- Create: `src/app/artist/[id]/_components/onboarding/StepCards.tsx`
- Test: `src/app/artist/[id]/_components/onboarding/__tests__/StepCards.test.tsx`

**Interfaces:**
- Consumes: `useOnboardingChat`, `ChatItem`, `ClientTurnShape` from Task 9; step payload shapes from Task 7.
- Produces: `<OnboardingChat artistId artistName onSkip />` (same props as the stub — the gate does not change); `StepCards.tsx` exports `ProfilesCard`, `VaultCard`, `InterviewInput`, `AboutDraftCard`.

- [ ] **Step 1: Write the failing tests** — `src/app/artist/[id]/_components/onboarding/__tests__/StepCards.test.tsx`:

```tsx
// @ts-nocheck
import { jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfilesCard, VaultCard, InterviewInput, AboutDraftCard } from '../StepCards';

describe('ProfilesCard — accepted-by-default', () => {
    const payload = {
        artistName: 'Nova Reyes',
        links: [{ siteName: 'spotify', value: 'spot1' }, { siteName: 'instagram', value: 'nova' }],
        enrichment: { platform: 'deezer', followerCount: 128000, imageUrl: null },
    };

    it('renders every link pre-accepted and submits only removals + additions', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payload} onConfirm={onConfirm} disabled={false} />);
        // Remove instagram, then confirm
        fireEvent.click(screen.getByLabelText(/remove instagram/i));
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({ addedLinks: [], removedSiteNames: ['instagram'] });
    });

    it('collects pasted links as additions', () => {
        const onConfirm = jest.fn();
        render(<ProfilesCard payload={payload} onConfirm={onConfirm} disabled={false} />);
        fireEvent.change(screen.getByPlaceholderText(/paste a link/i), { target: { value: 'https://tiktok.com/@nova' } });
        fireEvent.click(screen.getByRole('button', { name: /add/i }));
        fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
        expect(onConfirm).toHaveBeenCalledWith({
            addedLinks: [{ url: 'https://tiktok.com/@nova' }],
            removedSiteNames: [],
        });
    });
});

describe('VaultCard — keep-by-default', () => {
    const payload = {
        sources: [
            { id: 's1', title: 'Pitchfork review', url: 'https://p4k.example/x', snippet: 'bedroom auteur' },
            { id: 's2', title: 'Fan wiki', url: 'https://wiki.example/y', snippet: null },
        ],
    };

    it('submits kept sources as approved and skipped ones as rejected', () => {
        const onConfirm = jest.fn();
        render(<VaultCard payload={payload} onConfirm={onConfirm} disabled={false} />);
        fireEvent.click(screen.getByLabelText(/skip fan wiki/i));
        fireEvent.click(screen.getByRole('button', { name: /keep these/i }));
        expect(onConfirm).toHaveBeenCalledWith({
            decisions: [
                { sourceId: 's1', status: 'approved' },
                { sourceId: 's2', status: 'rejected' },
            ],
            addedUrls: [],
        });
    });

    it('collects pasted URLs as artist-added sources (spec §9 paste-a-link degrade)', () => {
        const onConfirm = jest.fn();
        render(<VaultCard payload={{ sources: [] }} onConfirm={onConfirm} disabled={false} />);
        fireEvent.change(screen.getByPlaceholderText(/paste a link/i), { target: { value: 'https://press.example/nova' } });
        fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
        expect(onConfirm).toHaveBeenCalledWith({ decisions: [], addedUrls: ['https://press.example/nova'] });
    });

    it('renders a continue button even with zero sources (empty-confirm is valid)', () => {
        const onConfirm = jest.fn();
        render(<VaultCard payload={{ sources: [] }} onConfirm={onConfirm} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
        expect(onConfirm).toHaveBeenCalledWith({ decisions: [], addedUrls: [] });
    });
});

describe('InterviewInput', () => {
    const payload = { questionKey: 'offline_fact', question: 'Whats offline?', number: 2, total: 3 };

    it('submits typed answers', () => {
        const onAnswer = jest.fn();
        render(<InterviewInput payload={payload} onAnswer={onAnswer} disabled={false} />);
        fireEvent.change(screen.getByPlaceholderText(/type your answer/i), { target: { value: 'water tower' } });
        fireEvent.click(screen.getByRole('button', { name: /send/i }));
        expect(onAnswer).toHaveBeenCalledWith({ questionKey: 'offline_fact', answer: 'water tower' });
    });

    it('skip submits a null answer', () => {
        const onAnswer = jest.fn();
        render(<InterviewInput payload={payload} onAnswer={onAnswer} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: /skip/i }));
        expect(onAnswer).toHaveBeenCalledWith({ questionKey: 'offline_fact', answer: null });
    });
});

describe('AboutDraftCard', () => {
    it('publish passes the exact doc + about back (stateless-turn round-trip)', () => {
        const onPublish = jest.fn();
        render(<AboutDraftCard doc="## Overview\nd" about="An About." onPublish={onPublish} disabled={false} />);
        fireEvent.click(screen.getByRole('button', { name: /publish/i }));
        expect(onPublish).toHaveBeenCalledWith({ doc: '## Overview\nd', about: 'An About.' });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest "src/app/artist/[id]/_components/onboarding/__tests__/StepCards.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `StepCards.tsx`:**

```tsx
"use client";

import { useState } from "react";

// ---------- Profiles: accepted-by-default. Leaving a card as-is IS confirmation. ----------

type ProfilesPayload = {
    artistName: string;
    links: { siteName: string; value: string }[];
    enrichment: { platform: string; followerCount: number | null; imageUrl: string | null } | null;
};

export function ProfilesCard({ payload, onConfirm, disabled }: {
    payload: ProfilesPayload;
    onConfirm: (r: { addedLinks: { url: string }[]; removedSiteNames: string[] }) => void;
    disabled: boolean;
}) {
    const [removed, setRemoved] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<string[]>([]);
    const [draft, setDraft] = useState("");

    const toggleRemoved = (siteName: string) => {
        setRemoved(prev => {
            const next = new Set(prev);
            if (next.has(siteName)) next.delete(siteName); else next.add(siteName);
            return next;
        });
    };

    const fmtFollowers = (n: number) =>
        n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : `${n}`;

    return (
        <div className="glass rounded-xl p-4 space-y-2 w-full">
            {payload.links.map(link => (
                <div
                    key={link.siteName}
                    className={`flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 ${removed.has(link.siteName) ? "opacity-40 line-through" : ""}`}
                >
                    <div className="min-w-0">
                        <span className="font-medium capitalize">{link.siteName}</span>
                        <span className="text-sm text-gray-500 ml-2 break-all">{link.value}</span>
                        {payload.enrichment && link.siteName === payload.enrichment.platform && payload.enrichment.followerCount != null && (
                            <span className="text-xs text-gray-400 ml-2">{fmtFollowers(payload.enrichment.followerCount)} fans</span>
                        )}
                    </div>
                    <button
                        aria-label={`remove ${link.siteName}`}
                        onClick={() => toggleRemoved(link.siteName)}
                        disabled={disabled}
                        className="text-gray-400 hover:text-red-500 px-2"
                    >
                        ✕
                    </button>
                </div>
            ))}
            {added.map(url => (
                <div key={url} className="text-sm text-green-600 dark:text-green-400 px-3">+ {url}</div>
            ))}
            <div className="flex gap-2 pt-1">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Paste a link we missed…"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
                />
                <button
                    onClick={() => { if (draft.trim()) { setAdded(prev => [...prev, draft.trim()]); setDraft(""); } }}
                    disabled={disabled || !draft.trim()}
                    className="text-sm px-3 py-2 rounded-lg border border-pink-500 text-pink-500 disabled:opacity-40"
                >
                    Add
                </button>
            </div>
            <button
                onClick={() => onConfirm({ addedLinks: added.map(url => ({ url })), removedSiteNames: [...removed] })}
                disabled={disabled}
                className="w-full bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2.5 rounded-lg mt-1 disabled:opacity-50"
            >
                Looks good, continue
            </button>
        </div>
    );
}

// ---------- Vault: keep-by-default ----------

type VaultPayload = { sources: { id: string; title: string | null; url: string; snippet: string | null }[] };

export function VaultCard({ payload, onConfirm, disabled }: {
    payload: VaultPayload;
    onConfirm: (r: { decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }) => void;
    disabled: boolean;
}) {
    const [skipped, setSkipped] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<string[]>([]);
    const [draft, setDraft] = useState("");

    const toggle = (id: string) => setSkipped(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const submit = () => onConfirm({
        decisions: payload.sources.map(s => ({
            sourceId: s.id,
            status: skipped.has(s.id) ? "rejected" as const : "approved" as const,
        })),
        addedUrls: added,
    });

    return (
        <div className="glass rounded-xl p-4 space-y-2 w-full">
            {payload.sources.map(s => (
                <div
                    key={s.id}
                    className={`rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 flex items-start justify-between gap-2 ${skipped.has(s.id) ? "opacity-40" : ""}`}
                >
                    <div className="min-w-0">
                        <p className="font-medium truncate">{s.title ?? s.url}</p>
                        {s.snippet && <p className="text-sm text-gray-500 line-clamp-2">{s.snippet}</p>}
                    </div>
                    <button
                        aria-label={`${skipped.has(s.id) ? "keep" : "skip"} ${s.title ?? s.url}`}
                        onClick={() => toggle(s.id)}
                        disabled={disabled}
                        className="text-sm whitespace-nowrap px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600"
                    >
                        {skipped.has(s.id) ? "keep" : "skip"}
                    </button>
                </div>
            ))}
            {added.map(url => (
                <div key={url} className="text-sm text-green-600 dark:text-green-400 px-3">+ {url}</div>
            ))}
            <div className="flex gap-2 pt-1">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Paste a link — press, an interview, your site…"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
                />
                <button
                    onClick={() => { if (draft.trim()) { setAdded(prev => [...prev, draft.trim()]); setDraft(""); } }}
                    disabled={disabled || !draft.trim()}
                    className="text-sm px-3 py-2 rounded-lg border border-pink-500 text-pink-500 disabled:opacity-40"
                >
                    Add
                </button>
            </div>
            <button
                onClick={submit}
                disabled={disabled}
                className="w-full bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2.5 rounded-lg mt-1 disabled:opacity-50"
            >
                {payload.sources.length > 0 ? "Keep these, continue" : "Continue"}
            </button>
        </div>
    );
}

// ---------- Interview ----------

type InterviewPayload = { questionKey: string; question: string; number: number; total: number };

export function InterviewInput({ payload, onAnswer, disabled }: {
    payload: InterviewPayload;
    onAnswer: (r: { questionKey: string; answer: string | null }) => void;
    disabled: boolean;
}) {
    const [draft, setDraft] = useState("");
    return (
        <div className="w-full space-y-2">
            <p className="text-xs text-gray-400">Question {payload.number} of {payload.total} — all optional</p>
            <div className="flex gap-2">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && draft.trim()) onAnswer({ questionKey: payload.questionKey, answer: draft.trim() }); }}
                    placeholder="Type your answer…"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2"
                />
                <button
                    onClick={() => onAnswer({ questionKey: payload.questionKey, answer: draft.trim() })}
                    disabled={disabled || !draft.trim()}
                    className="bg-pink-500 text-white font-semibold px-4 rounded-lg disabled:opacity-40"
                >
                    Send
                </button>
            </div>
            <button
                onClick={() => onAnswer({ questionKey: payload.questionKey, answer: null })}
                disabled={disabled}
                className="text-sm text-gray-500 underline"
            >
                Skip this one
            </button>
        </div>
    );
}

// ---------- About draft: show finished work, ask one yes/no ----------

export function AboutDraftCard({ doc, about, onPublish, disabled }: {
    doc: string;
    about: string;
    onPublish: (r: { doc: string; about: string }) => void;
    disabled: boolean;
}) {
    return (
        <div className="glass rounded-xl p-4 space-y-3 w-full">
            <h3 className="font-bold text-pink-500">Your About</h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{about}</p>
            <button
                onClick={() => onPublish({ doc, about })}
                disabled={disabled}
                className="w-full bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
            >
                Publish this
            </button>
            <p className="text-xs text-gray-400">
                This also saves your artist doc — it powers your page's Q&amp;A and fun facts.
            </p>
        </div>
    );
}
```

- [ ] **Step 4: Replace the `OnboardingChat.tsx` stub wholesale:**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOnboardingChat, type ChatItem } from "./useOnboardingChat";
import { ProfilesCard, VaultCard, InterviewInput, AboutDraftCard } from "./StepCards";

type Props = { artistId: string; artistName: string; onSkip: () => void };

export default function OnboardingChat({ artistId, artistName, onSkip }: Props) {
    const { items, busy, sendTurn } = useOnboardingChat(artistId);
    const router = useRouter();
    const opened = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!opened.current) {
            opened.current = true;
            void sendTurn({ type: "open" });
        }
    }, [sendTurn]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [items]);

    const complete = items.some(i => i.kind === "complete");
    // Only the LAST step/draft item is interactive — earlier ones are history.
    const lastInteractiveId = [...items].reverse().find(i => i.kind === "step" || i.kind === "draft")?.id;

    const renderItem = (item: ChatItem) => {
        const interactive = item.id === lastInteractiveId && !busy && !complete;
        switch (item.kind) {
            case "bot":
                return <div className="glass rounded-2xl rounded-bl-md px-4 py-2.5 max-w-[85%] self-start">{item.text}</div>;
            case "user":
                return <div className="bg-pink-500 text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[85%] self-end">{item.text}</div>;
            case "progress":
                return (
                    <div className="self-start text-xs px-3 py-1 rounded-full border border-blue-300/40 text-gray-500">
                        {item.done ? "✓" : "⚙"} {item.text}
                    </div>
                );
            case "error":
                return <div className="self-start text-sm text-amber-600 dark:text-amber-400 px-1">{item.text}</div>;
            case "step": {
                if (item.step === "profiles") return <ProfilesCard payload={item.payload as never} disabled={!interactive} onConfirm={r => void sendTurn({ type: "confirm_profiles", ...r })} />;
                if (item.step === "vault") return <VaultCard payload={item.payload as never} disabled={!interactive} onConfirm={r => void sendTurn({ type: "vault_review", ...r })} />;
                if (item.step === "interview") return <InterviewInput payload={item.payload as never} disabled={!interactive} onAnswer={r => void sendTurn({ type: "interview_answer", ...r })} />;
                return null;
            }
            case "draft":
                return <AboutDraftCard doc={item.doc ?? ""} about={item.about ?? ""} disabled={!interactive} onPublish={r => void sendTurn({ type: "publish", ...r })} />;
            case "complete":
                return (
                    <div className="self-stretch text-center glass rounded-xl p-4">
                        <p className="text-2xl">🎉</p>
                        <p className="font-semibold">You're live!</p>
                        <button
                            onClick={() => { router.refresh(); onSkip(); }}
                            className="mt-2 bg-pink-500 text-white font-semibold px-4 py-2 rounded-lg"
                        >
                            See my page
                        </button>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-[480px] h-[85vh] glass rounded-2xl flex flex-col overflow-hidden bg-white/90 dark:bg-gray-900/90">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <p className="font-bold">Set up {artistName}</p>
                    {!complete && (
                        <button onClick={onSkip} className="text-sm text-gray-500 hover:text-gray-700">
                            Skip for now
                        </button>
                    )}
                </div>
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
                    {items.map(item => (
                        <div key={item.id} className="flex flex-col">{renderItem(item)}</div>
                    ))}
                    {busy && <div className="self-start text-gray-400 text-sm px-2 animate-pulse">…</div>}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest "src/app/artist/[id]/_components/onboarding"`
Expected: PASS (StepCards + the Task 9 gate tests, which exercise the real OnboardingChat via their mock).

- [ ] **Step 6: Commit**

```bash
git add "src/app/artist/[id]/_components/onboarding/"
git commit -m "feat(onboarding): chat surface with accepted-by-default cards, interview input, and live About draft"
```

---

### Task 11: Full CI + manual QA

**Files:** none new — verification only.

- [ ] **Step 1: Full pipeline**

Run: `npm run type-check && npm run lint && npm run test && npm run build`
Expected: all four PASS. Fix anything that fails before proceeding (build needs `.env.local` — see CLAUDE.md for the stub if missing).

- [ ] **Step 2: Manual QA in dev** (`npm run dev`, needs a dev admin account + a claimable artist):

1. Claim an artist with a non-admin test user → admin approves in `/admin` Claims tab → confirm the approval email arrives (or, without `RESEND_API_KEY`, confirm the skip is logged and nothing breaks).
2. Visit the artist page as the claimant → full-screen chat opens at the profiles step. Confirm cards show existing links; paste one valid and one garbage URL — garbage degrades politely.
3. Kill the tab mid-flow, reopen → chat resumes at the correct step (derived state), and answered interview questions are not re-asked.
4. "Skip for now" → banner appears; reload → banner persists this session; new session (new tab after closing browser or clearing sessionStorage) → takeover reopens.
5. Finish through publish → About appears on the page, `artist_docs` row exists, Ask-About answers reflect interview facts.
6. Admin revokes the claim → verify `artist_docs`, `artist_interview_answers`, `artist_onboarding_steps` rows are gone and `artists.bio` is cleared; re-claim + approve → onboarding starts fresh.
7. As a logged-out visitor, load the artist page → no onboarding query, no gate, page renders normally.

- [ ] **Step 3: Commit any QA fixes, then final check**

```bash
git status   # clean, all commits conventional, branch pete/recoup-onboarding-exploration
```

Do NOT push or open a PR in this task — shipping goes through the user (PRs target `staging` per CLAUDE.md).

---

## Deferred (do not build — designed seams only)

Apify social ingestion, progressive question-bank UI, connection graph, Arweave `storage_url` — all specced as fast-follows in the design doc §11. If you find yourself building any of these, stop: you are out of scope.
