# MEMORY.md — Music Nerd project log

Living doc for where the project is, what's in flight, and ideas/backlog. Committed to the repo so it stays shared and current. Update as we go — add to "Recently shipped" when something lands, move items out of "Backlog" as we pick them up.

## Recently shipped
- **Artist asset uploads fixed** (profile photos + vault files): storage env vars provisioned on staging + prod; prod `vault-files` bucket created; `.md`/empty-MIME recovery + a clear "storage not configured" 503 instead of a generic 500. (#1153 → #1154)
- **Real (unmocked) test layers**: `/api/health` + post-deploy smoke workflow, real-storage integration smoke, a browser E2E (login → upload → verify), and a vault → "Ask About" chat E2E proving uploaded files feed the answers.
- **De-flaked** the `referenceCode` "unique codes" test (#1155).

## In progress
- **Artist "About" accuracy** — fixing same-name conflation (e.g. Black Dave MK2 was getting a different "Black Dave"'s discography) and relationship-inflation (Pete Rango "collaborated with" artists he actually did live sound for).
  - Spec: `docs/superpowers/specs/2026-08-16-about-primary-source-first-design.md`
  - Plan: `docs/superpowers/plans/2026-08-16-about-verified-grounding.md`
  - **Committed so far** (branch `pete/about-verified-grounding`): verified-ID grounding (Spotify → Wikidata → Wikipedia), real-catalog injection, hard guardrails, "About" rename, claim-nudge empty-state, stop-auto-regen-on-link-change, sources→vault discovery. Full suite green.
  - **DECISION (2026-08-16): unify on the vault as the single source system.** Empirically, the vault "Search web for sources" (Flash, identity-anchored, structured) finds cleaner, conflation-safe sources than the About's own free grounding (which pulled the *wrong* Black Dave's skate pages). So: **the About should synthesize from vault sources + verified catalog with its own web grounding turned OFF** — conflation is killed at the source, not patched in output.
  - **Refined rules from scenario testing:** (1) has Spotify/socials → identity-anchored discovery → synthesize from discovered sources + real catalog (grounding off); if discovery returns nothing (it's flaky — 8 sources one run, 0 the next), fall back to catalog-only + retry. (2) **NO identity links → do NOT run name-only discovery** (it conflates — validated on link-less "Black Dave") → conservative/empty-state + nudge to add a link/claim. Catalog is the reliable floor.
  - **Shipping now (PR #1 — validated accuracy fixes, low risk):** discovery **retry** until parseable-non-empty (fixes Grimes → 0 sources; root cause = transient empty Gemini responses); **catalog-anchor disambiguation rule** in the generator prompt (fixes the Sammie namesake conflation — "catalog is ground truth; discard sources describing a different body of work; don't pad with a track listing"). Combined with the already-committed verified-ID grounding + catalog injection + guardrails, this resolves conflation across every tested case (Black Dave, Sammie, RAC, Grimes, no-links).
  - **Next PR (unified architecture — larger, deliberate):** turn the About's own web grounding OFF and make it **synthesize from vault sources** — which requires making **discovery synchronous** in the generation path (flipping grounding off without that would collapse coverage for unclaimed artists, since their sources are discovered async). Plus **Deezer→Spotify abstraction** for the catalog (consistency + Phase-5 Deezer-only; Spotify currently covers 39,530/43,133 so it's a consistency/future fix, not a coverage gap) and **verified-ID grounding via Deezer P2722**. The grounded fact-check pass is likely unnecessary once grounding is off + sources curated (revisit then).

## Backlog / ideas
- **Guard the "regenerate About" action** so only an **admin or the artist who claimed the profile** can trigger it (currently the regenerate path isn't role-gated). *[not started — recorded 2026-08-16]*
- **Strict fact-check**: diff generated claims (releases, collaborators) against the artist's **real Spotify catalog** — needs valid Spotify creds (see Known issues).
- **Real-catalog injection**: feed the artist's real release/collaborator names into the generator as ground truth — needs valid Spotify creds.
- Preserve artist-authored About via an `about_source` marker — largely moot once auto-regen-on-link-change is removed; revisit only if a non-deliberate regen path returns.
- CI hardening (#1150), Vercel ~4.5 MB serverless body cap on uploads (#1151), wire `db:migrate` into deploy + reconcile untracked migrations 0007–0010 (#1148), reconcile `schema.ts` RLS policy text (#1149).

## Known issues / tech debt
- **Spotify creds now authenticate locally (2026-08-16)** — `.env.local` updated, token request returns 200 and real artist catalog data comes back. Confirm the same values are in Vercel (Production + Preview) so prod matches. This **unblocks real-catalog injection + strict fact-check** for the About feature.
- **Minor hardening (low severity, separate pass):** the Spotify Client Secret env var is `NEXT_PUBLIC_`-prefixed, which inlines it into the browser bundle. It's used only server-side, so it should be renamed to a non-`NEXT_PUBLIC_` name (server-only). Do it as its own backward-compatible change (accept either name during migration) + verify with type-check/build/test. Not urgent — read-only client-credentials secret, no user data.
- Storage env-var + bucket provisioning was tracked in #1152 (now resolved).
