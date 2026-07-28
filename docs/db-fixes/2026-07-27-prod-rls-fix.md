# Prod RLS fix — artist-profile-edit tables

**Date:** 2026-07-27
**Migration:** `drizzle/0010_fix_artist_edit_rls_policies.sql`
**Restore point:** `docs/db-backups/prod-rls-policies-snapshot-2026-07-27.csv`

## Symptom

On **production**, three user-facing features silently failed for everyone:
- **Profile claiming** — "Failed to claim artist profile"
- **Vault sources** (add / web-search) — writes never landed (0 rows in the table, ever)
- **Save bio to vault** — raw DB error surfaced to the user

The same features work fine on **Dev** and **staging**.

## Root cause

The app connects to Postgres as the role **`mnweb`**. Three tables have RLS enabled but
their `mnweb` policies were created **out-of-band** (Supabase-managed, not via tracked
migrations) with **empty `USING` / `WITH CHECK` expressions** on prod. A permissive RLS
policy with no check expression grants nothing, so RLS **silently blocks** the app from
inserting/updating.

| Table | Broken op(s) on prod |
|---|---|
| `artist_claims` | INSERT, SELECT, UPDATE |
| `artist_vault_sources` | INSERT, SELECT, UPDATE |
| `artist_bio_versions` | INSERT, UPDATE |

Dev/staging have the correct expressions (matching the working pattern on `ugcresearch` /
`artists`), which is why it's a **prod config drift**, not a code bug. Verified via a full
audit of every RLS-enabled table's `mnweb` coverage; the app writes to no other affected table.

## Status

**All three tables fixed on prod (2026-07-27) and re-verified** — `mnweb` can INSERT/SELECT/
UPDATE on each. `artist_claims` + `artist_vault_sources` were applied first (claiming re-verified
working); `artist_bio_versions` was applied after DB-owner sign-off.

The tracked migration (`0010`) uses `DROP POLICY IF EXISTS` + `CREATE POLICY` (rather than the
`ALTER POLICY` shown below) so it is portable to environments where the policies don't already
exist — e.g. a from-scratch DB or a pipeline replaying `drizzle/*.sql` end-to-end.

## The fix (idempotent, low-risk)

Restores the correct permissive expressions in place. Safe to run repeatedly. Apply via the
Supabase SQL Editor on the **Music Nerd** (prod) project, or let the migration pipeline apply
`0010`:

```sql
-- artist_claims
ALTER POLICY mnweb_insert_artist_claims ON artist_claims WITH CHECK (true);
ALTER POLICY mnweb_select_artist_claims ON artist_claims USING (true);
ALTER POLICY mnweb_update_artist_claims ON artist_claims USING (true) WITH CHECK (true);
-- artist_vault_sources
ALTER POLICY mnweb_insert_artist_vault_sources ON artist_vault_sources WITH CHECK (true);
ALTER POLICY mnweb_select_artist_vault_sources ON artist_vault_sources USING (true);
ALTER POLICY mnweb_update_artist_vault_sources ON artist_vault_sources USING (true) WITH CHECK (true);
-- artist_bio_versions (the remaining broken one)
ALTER POLICY mnweb_insert_artist_bio_versions ON artist_bio_versions WITH CHECK (true);
ALTER POLICY mnweb_update_artist_bio_versions ON artist_bio_versions USING (true) WITH CHECK (true);
```

(The claims/vault lines are no-ops now — included so the migration is the complete record.)

## The bigger issue — environment drift

This is one of several prod/Dev/staging drift problems found in the same period:
1. Migrations `0007`–`0010` are **not applied to prod** (schema/policies out of sync with code).
2. Subvert/Bluesky columns had to be added to prod and Dev by hand.
3. These broken RLS policies.

**Recommendation:** get the migration step running against **prod** (and Dev/staging) in the
deploy pipeline, and reconcile the existing drift, so schema + policies stop diverging from the
repo. Right now schema changes are applied manually, which is exactly how environments fall out
of sync.
