# MusicNerdWeb - Claude AI Assistant Guide

## Project Overview
MusicNerdWeb is a Next.js web application that serves as a crowd-sourced directory for music artists. It enables users to discover artists, manage artist data, and explore social media/platform connections across the music ecosystem.

## Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Privy (email-first) with NextAuth.js CredentialsProvider
- **Styling**: Tailwind CSS + SCSS
- **UI Components**: Radix UI primitives + custom components
- **Web3**: Privy SDK handles wallet signature verification for optional wallet linking (legacy account migration)
- **AI Integration**: OpenAI API for artist bios and fun facts
- **Testing**: Jest 30 with React Testing Library
- **State Management**: React Query (@tanstack/react-query)

## Key Features
1. **Artist Discovery & Search**: Search artists with combined local database and Spotify API results
2. **Social Media Aggregation**: Collect and display artist links from 40+ platforms
3. **Authentication**: Privy email-first login with optional wallet linking for legacy accounts
4. **AI-Powered Content**: Auto-generated artist biographies and fun facts
5. **User-Generated Content (UGC)**: Community-driven artist data collection with admin moderation
6. **Leaderboard System**: Track user contributions and rankings
7. **Admin Dashboard**: Manage users, whitelist contributors, moderate UGC, manage MCP keys, and view agent work
8. **Spotify Integration**: Rich artist data, images, and music embeds
9. **Cross-Platform ID Mapping**: Agent-driven mapping of artist IDs across Deezer, Apple Music, MusicBrainz, Wikidata, Tidal, Amazon Music, YouTube Music

## Project Structure
```
src/
├── app/                          # Next.js app router pages
│   ├── _components/             # Global shared components
│   ├── api/                     # API route handlers
│   │   ├── mcp/                 # MCP server (tools, auth, audit, transformers)
│   │   └── admin/               # Admin API routes (agent-work, mcp-keys, whitelist-user)
│   ├── artist/[id]/             # Dynamic artist pages
│   ├── admin/                   # Admin dashboard (UGC, Users, MCP Keys, Agent Work tabs)
│   ├── profile/                 # User profile pages
│   └── add-artist/              # Artist addition flow
├── components/ui/               # Reusable UI components (Radix-based)
├── server/                      # Server-side utilities
│   ├── auth.ts                  # NextAuth configuration
│   ├── db/                      # Database schema and client
│   └── utils/                   # Server utilities and queries
│       ├── artistLinkService.ts # Shared helpers for platform link writes
│       └── idMappingService.ts  # Cross-platform ID mapping (resolve, exclude, stats)
├── hooks/                       # Custom React hooks
├── lib/                         # Client-side utilities
└── types/                       # TypeScript type definitions

agents/
└── id-mapping/                  # Claude-powered agent for cross-platform ID mapping
    ├── prompt.md                # Agent prompt template
    ├── claude-runner.sh         # Streams Claude API responses
    ├── run-full-catalog.sh      # Orchestrates full catalog processing
    ├── start-workers.sh         # Parallel worker launcher
    ├── check-status.sh          # Worker monitoring + failure classification
    └── mcp-config.json          # MCP server configuration for agents
```

## Database Schema
Key entities in the PostgreSQL database:

### Core Tables
- **users**: User accounts with wallet addresses, admin/whitelist status
- **artists**: Main artist records with social media links and metadata
- **ugcresearch**: User-generated content submissions pending approval
- **urlmap**: Platform configuration and URL patterns for link validation
- **featured**: Featured artists and collectors
- **aiPrompts**: AI prompt templates for content generation
- **funFacts**: AI-generated fun facts about artists
- **mcp_api_keys**: API keys for MCP write tool authentication (SHA-256 hashed, revocable)
- **mcp_audit_log**: Append-only audit trail for MCP write operations
- **artist_id_mappings**: Cross-platform artist ID mappings (Deezer, Apple Music, MusicBrainz, Wikidata, Tidal, Amazon Music, YouTube Music). Tracks `confidence_level` (high/medium/low/manual) and `source` (wikidata/musicbrainz/name_search/web_search/manual).
- **artist_mapping_exclusions**: Tracks artists that cannot be mapped to a platform. Uses `exclusion_reason` enum: conflict, name_mismatch, too_ambiguous. Supports soft-deletion.

### Enums
- **platform_type**: 'social', 'web3', 'listen'
- **confidence_level**: 'high', 'medium', 'low', 'manual'
- **exclusion_reason**: 'conflict', 'name_mismatch', 'too_ambiguous'

### Important Relationships
- Artists are linked to users via `addedBy` (foreign key to users.id)
- UGC submissions reference both artist and user
- Platform links are validated against urlmap regex patterns
- ID mappings reference artists via `artist_id` (UUID FK to artists)

## Authentication System
- **Privy Email-First**: Users authenticate via Privy (email login as primary method)
- **NextAuth Integration**: CredentialsProvider named "privy" verifies Privy tokens
- **Token Formats**: Standard access token, `idtoken:` prefix, `privyid:` prefix (dev only)
- **Legacy Account Migration**: Lazy, user-initiated via `needsLegacyLink` session flag + `LegacyAccountModal`
- **Wallet Linking**: Optional — legacy wallet users can link their wallet to a Privy account via `mergeAccounts()`
- **Role-Based Access**: Admin and whitelist user roles
- **Session Management**: JWT-based sessions with 30-day expiry

## Rate Limiting Middleware
API rate limiting is implemented in `src/middleware.ts` (in-memory, applied to all `/api/*` except `/api/auth/*`):
- **Strict** (5 req/min): `/api/funFacts`, `/api/artistBio`
- **Medium** (20 req/min): `/api/validateLink`
- **Default** (60 req/min): all other API routes
- Limits are configurable via `RATE_LIMIT_STRICT`, `RATE_LIMIT_MEDIUM`, `RATE_LIMIT_DEFAULT`, and `RATE_LIMIT_WINDOW_MS` env vars
- In-memory storage resets on serverless cold starts and is not shared across workers — best-effort protection

## Auth Guard Helpers
`src/lib/auth-helpers.ts` provides reusable server-side guards for API routes:
- `requireAuth()` — returns 401 if not authenticated
- `requireAdmin()` — returns 401/403; does a real-time DB lookup to verify admin role
- `requireWhitelistedOrAdmin()` — returns 401/403 for neither role

Use these when writing new API endpoints that need auth/role checks.

## MCP Server (Model Context Protocol)

The MCP server at `/api/mcp` exposes tools for AI assistants to read and modify artist data via the Streamable HTTP transport.

### Tools

**Artist data (original):**
- **`search_artists`** — Search by name (read-only, no auth)
- **`get_artist`** — Get artist detail by UUID (read-only, no auth)
- **`set_artist_link`** — Set a platform link from a URL. Platform is auto-inferred via `extractArtistId()`. Requires auth.
- **`delete_artist_link`** — Remove a platform link by `siteName`. Requires auth.

**Cross-platform ID mapping (agent-focused):**
- **`get_unmapped_artists`** — Retrieves artists with Spotify ID but missing mappings for a given platform (read-only, no auth)
- **`get_mapping_stats`** — Returns platform coverage statistics (read-only, no auth)
- **`get_artist_mappings`** — Returns all cross-platform ID mappings for an artist (read-only, no auth)
- **`resolve_artist_id`** — Stores cross-platform ID mappings. Supports single-item or batch mode (up to 100 items). Requires auth.
- **`exclude_artist_mapping`** — Marks an artist+platform combo as unmappable (with reason). Supports single or batch (up to 100). Requires auth.
- **`get_mapping_exclusions`** — Retrieves exclusion records for analysis (read-only, no auth)

Write tools share the same code path as UGC submissions (`setArtistLink`/`clearArtistLink` in `artistLinkService.ts`), ensuring consistent validation and bio regeneration.

### Authentication
Write tools require a Bearer token in the `Authorization` header. Keys are SHA-256 hashed and stored in `mcp_api_keys`. Invalid/revoked keys receive a 401 response. Read-only tools are accessible without auth.

Auth context is threaded to tool handlers via `AsyncLocalStorage` (`request-context.ts`). Write tools call `requireMcpAuth()` as their first operation.

### API Key Provisioning
Keys can be managed via the Admin Dashboard → MCP Keys tab (create/revoke), or via SQL:

```bash
# Generate and insert a new key
export MCP_KEY=$(openssl rand -hex 32)
echo "Store securely — cannot be retrieved: $MCP_KEY"
echo "INSERT INTO mcp_api_keys (key_hash, label) VALUES (encode(sha256('$MCP_KEY'::bytea), 'hex'), 'agent-name');" | psql $SUPABASE_DB_CONNECTION

# Revoke a key
psql $SUPABASE_DB_CONNECTION -c "UPDATE mcp_api_keys SET revoked_at = now() WHERE label = 'agent-name';"
```

### Audit Logging
All write operations are logged to `mcp_audit_log` (append-only — no UPDATE/DELETE). Audit is best-effort; a failed audit insert does not roll back the mutation. Each entry records `artist_id`, `field`, `action`, `old_value`, `new_value`, `submitted_url`, and `api_key_hash`.

## API Endpoints
Key API routes in `src/app/api/`:
- `/searchArtists` - Artist search with Spotify integration
- `/validateLink` - Platform link validation
- `/artistBio/[id]` - AI-generated artist biographies
- `/funFacts/[type]` - AI-generated fun facts
- `/leaderboard` - User contribution rankings
- `/admin/whitelist-user/[id]` - Whitelist user management
- `/admin/mcp-keys` - MCP key CRUD (GET list, POST create)
- `/admin/mcp-keys/[id]/revoke` - Revoke an MCP API key
- `/admin/agent-work` - Agent activity data (coverage stats, per-agent breakdown, audit log, exclusions)
- `/auth/*` - Privy authentication routes
- `/mcp/*` - MCP server for exposing artist data to AI assistants
  - Read-only tools: `search_artists`, `get_artist`, `get_unmapped_artists`, `get_mapping_stats`, `get_artist_mappings`, `get_mapping_exclusions`
  - Write tools: `set_artist_link`, `delete_artist_link`, `resolve_artist_id`, `exclude_artist_mapping` (require API key auth)
- `/user` - User profile and wallet operations

### API Route Conventions
- **Performance logging**: Routes wrap handler bodies in `performance.now()` and log duration via `console.debug`
- **Timeout races**: AI routes use `Promise.race` with timeouts — `artistBio` 25s, `funFacts` 20s, `searchArtists` 12s
- **In-memory caching**: `searchArtists` and `searchArtists/batch` use a 5-minute TTL cache (same serverless caveat as rate limiting)
- **Error format**: Routes return `{ error: "message" }` (inconsistent in some older routes as `{ status, message }`)

## Server Actions
`src/app/actions/` contains Next.js Server Actions (all marked `"use server"`). These are thin wrappers — all business logic lives in `src/server/utils/queries/`.

## Coding Conventions

### Style
- **Package manager**: `npm` (not bun/yarn/pnpm — ignore the `bun.lockb` file)
- **Node version**: 20
- **Indentation**: Mixed across the codebase (2 and 4 spaces). Match the file you're editing.
- **Path alias**: `@/` → `src/`. Use `@/` for cross-module imports; relative paths for same-feature-folder imports.
- **Env vars in server code**: Import from `@/env`, never use `process.env` directly. In test env (`NODE_ENV=test`), validation returns `'test-value'` so tests run without `.env.local`.

### Components
- Components are **Server Components by default** (Next.js App Router). Add `"use client"` as the first line when using hooks, event handlers, or browser APIs.
- Server components call `getServerAuthSession()` from `@/server/auth`. Client components use `useSession()` from `next-auth/react`.
- Use `cn()` from `@/lib/utils` for Tailwind class merging.

### API Routes
- Dynamic params are a `Promise` in Next.js 15: `{ params }: { params: Promise<{ id: string }> }` — always `await params`.
- Add `export const dynamic = "force-dynamic"` to routes that read from the database, or Next.js may statically cache the response at build time.
- Named exports for HTTP methods (`GET`, `POST`, etc.) — no default export.

## Writing Tests
Tests use Jest 30 with JSDOM. The test infrastructure has significant boilerplate — follow these patterns exactly.

### API Route Test Template
```typescript
// @ts-nocheck
import { jest } from '@jest/globals';

// Mock dependencies BEFORE dynamic imports
jest.mock('@/lib/auth-helpers', () => ({ requireAuth: jest.fn() }));
jest.mock('@/server/utils/queries/someQueries', () => ({ myQuery: jest.fn() }));

// Polyfill Response.json (JSDOM doesn't have it)
if (!('json' in Response)) {
  Response.json = (data, init) =>
    new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      status: init?.status || 200,
    });
}

describe('GET /api/example', () => {
  beforeEach(() => { jest.resetModules(); });

  async function setup() {
    const { requireAuth } = await import('@/lib/auth-helpers');
    const { GET } = await import('../route');
    return { GET, mockRequireAuth: requireAuth as jest.Mock };
  }

  // For dynamic routes, params must be a Promise:
  // { params: Promise.resolve({ id: 'some-id' }) }
});
```

### Key testing facts
- **File location**: API route tests go in `__tests__/` subdirectory co-located with the route (e.g. `src/app/api/user/[id]/__tests__/route.test.ts`). Shared utility tests go in `src/__tests__/` or `src/lib/__tests__/`.
- **Global mocks** (already set up in `jest.setup.ts` — don't re-mock these):
  - `@/server/db/drizzle` (db object with query.urlmap/artists/users/ugcresearch)
  - `openai` (returns `'mocked response'`)
  - `@/app/actions/serverActions` (all server actions)
  - `next/router`, `next/navigation`, `global.fetch`, `window.matchMedia`
- **`jest.resetModules()` + dynamic imports** are required for API route tests so mocks apply before the route module loads
- **Test timeout**: 20 seconds

## Development Workflow

### Available Scripts
```bash
npm run dev          # Start development server with HTTPS
npm run build        # Production build
npm run test         # Run Jest tests
npm run test:watch   # Jest in watch mode
npm run test:coverage # Test coverage report
npm run test:ci      # Jest with --ci --coverage (used in CI)
npm run lint         # ESLint
npm run type-check   # TypeScript checking
npm run ci           # Full CI pipeline (type-check + lint + test:ci + build)
```

### Database Commands
```bash
npm run db:generate  # Generate Drizzle migrations
npm run db:push     # Push schema to database
npm run db:migrate  # Run migrations
npm run db:studio   # Open Drizzle Studio
```

### Environment Variables
Required in `.env.local`:
- `SUPABASE_DB_CONNECTION` - PostgreSQL connection string
- `NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID/SECRET` - Spotify API credentials
- `NEXTAUTH_URL/SECRET` - NextAuth configuration
- `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` - Privy client and server credentials
- `OPENAI_API_KEY` - For AI features
- `DISCORD_WEBHOOK_URL` - UGC notifications

Optional (in `.env.local`):
- `OPENAI_TIMEOUT_MS` (default 60000ms) / `OPENAI_MODEL` - OpenAI config overrides
- `RATE_LIMIT_STRICT` / `RATE_LIMIT_MEDIUM` / `RATE_LIMIT_DEFAULT` / `RATE_LIMIT_WINDOW_MS` - Rate limit tuning
- `NEXT_PUBLIC_ALLOWED_ORIGIN` (default `"*"`) - CORS origin for select API routes (read via `process.env`, not `@/env`)
- `TIMEOUT_COUNT` (default 900s) - Discord UGC notification cooldown (read via `process.env`, not `@/env`)

CI-only (GitHub Actions secrets, not set locally):
- `DISCORD_COVERAGE_URL` - Webhook for CI coverage reports

Environment variables are validated via `src/env.ts` — review before adding new ones.

## Key Components

### Artist Management
- `src/app/artist/[id]/page.tsx` - Artist detail pages
- `src/app/_components/ArtistLinks.tsx` - Social media link display
- `src/server/utils/queries/artistQueries.ts` - Database queries

### Authentication Flow
- `src/server/auth.ts` - NextAuth configuration with Privy CredentialsProvider
- `src/app/_components/nav/components/Login.tsx` - Login UI wrapper
- `src/app/_components/nav/components/PrivyLogin.tsx` - Privy login component
- `src/app/_components/PrivyProviderWrapper.tsx` - Privy context provider
- `src/server/utils/privy.ts` - Privy token verification utilities

### Search Functionality
- `src/app/_components/nav/components/SearchBar.tsx` - Search interface
- `src/app/api/searchArtists/route.ts` - Combined DB + Spotify search

### MCP Server
- `src/app/api/mcp/server.ts` - Tool registration (10 tools: artist data + ID mapping)
- `src/app/api/mcp/route.ts` - HTTP transport + auth context threading
- `src/app/api/mcp/auth.ts` - API key validation + requireMcpAuth()
- `src/app/api/mcp/audit.ts` - Audit log helper
- `src/app/api/mcp/request-context.ts` - AsyncLocalStorage for auth threading
- `src/app/api/mcp/transformers/` - Response formatting (artist-summary.ts, artist-detail.ts)
- `src/server/utils/artistLinkService.ts` - setArtistLink/clearArtistLink helpers
- `src/server/utils/idMappingService.ts` - Cross-platform ID mapping service (resolve, exclude, stats, batch operations)

### Admin Dashboard
- `src/app/admin/page.tsx` - Admin page with tab layout (AdminTabs)
- `src/app/admin/AdminTabs.tsx` - Tab navigation: UGC, Users, MCP Keys, Agent Work
- `src/app/admin/McpKeysSection.tsx` - Create/revoke MCP API keys (replaces manual SQL)
- `src/app/admin/AgentWorkSection.tsx` - Agent activity: coverage stats, per-agent breakdown, paginated audit log, exclusions by platform
- `src/server/utils/queries/agentWorkQueries.ts` - Queries for agent work data (audit log, agent breakdown, exclusions)
- `src/server/utils/queries/mcpKeyQueries.ts` - MCP key CRUD queries

### ID Mapping Agent
- `agents/id-mapping/` - Complete agent framework for cross-platform ID mapping at scale
- Uses Claude API + MCP tools to map Spotify artist IDs to other platforms
- Supports parallel workers, failure classification, and progress monitoring

## Git Workflow
- **Branching**: Feature branches off `staging` → PR to `staging` → PR from `staging` to `main`
- **Branch naming**: `username/feature-name` (e.g. `clt/new-endpoint`, `Piper/darkmode`)
- **Commit messages**: Conventional commits — `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `revert:`
- **PRs always target `staging`**, never `main` directly
- **Before pushing**: Run all checks and fix any failures:
  ```bash
  npm run type-check && npm run lint && npm run test && npm run build
  ```
  Note: `npm run test` works without `.env.local` (env vars fall back to `'test-value'` when `NODE_ENV=test`), but `npm run build` requires `.env.local` or the build will throw. If no `.env.local` exists, stub one with the minimum required vars:
  ```bash
  printf 'NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID=stub\nNEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET=stub\nOPENAI_API_KEY=stub\n' > .env.local
  ```
  These three are the only vars that throw on missing values (see `src/env.ts`). All others default to `""`.
- **CI**: GitHub Actions automatically runs the same checks (type-check → lint → test → build) on every push and PR

## Important Notes for Claude
1. **Database First**: Most data operations go through Drizzle ORM queries. Import types from `@/server/db/DbTypes`, not from drizzle-orm directly.
2. **External Dependencies**: Heavy integration with Spotify API and OpenAI — these are mocked in tests.
3. **ESLint**: Flat config (`eslint.config.mjs`). `@typescript-eslint/no-explicit-any` and `@typescript-eslint/ban-ts-comment` are warnings, not errors. Test files have these rules disabled entirely.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
