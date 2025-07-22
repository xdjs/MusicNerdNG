# MusicNerdNG - Claude AI Assistant Guide

## Project Overview
MusicNerdNG is a Next.js web application that serves as a crowd-sourced directory for music artists. It enables users to discover artists, manage artist data, and explore social media/platform connections across the music ecosystem.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: NextAuth.js with Web3 wallet support (SIWE)
- **Styling**: Tailwind CSS + SCSS
- **UI Components**: Radix UI primitives + custom components
- **Web3**: RainbowKit, Wagmi, SIWE for wallet authentication
- **AI Integration**: OpenAI API for artist bios and fun facts
- **Testing**: Jest with React Testing Library
- **State Management**: React Query (@tanstack/react-query)

## Key Features
1. **Artist Discovery & Search**: Search artists with combined local database and Spotify API results
2. **Social Media Aggregation**: Collect and display artist links from 40+ platforms
3. **Web3 Authentication**: Wallet-based login with ENS support
4. **AI-Powered Content**: Auto-generated artist biographies and fun facts
5. **User-Generated Content (UGC)**: Community-driven artist data collection with admin moderation
6. **Leaderboard System**: Track user contributions and rankings
7. **Admin Dashboard**: Manage users, whitelist contributors, and moderate UGC
8. **Spotify Integration**: Rich artist data, images, and music embeds

## Project Structure
```
src/
├── app/                          # Next.js app router pages
│   ├── _components/             # Global shared components
│   ├── api/                     # API route handlers
│   ├── artist/[id]/             # Dynamic artist pages
│   ├── admin/                   # Admin dashboard
│   ├── profile/                 # User profile pages
│   └── add-artist/              # Artist addition flow
├── components/ui/               # Reusable UI components (Radix-based)
├── server/                      # Server-side utilities
│   ├── auth.ts                  # NextAuth configuration
│   ├── db/                      # Database schema and client
│   └── utils/                   # Server utilities and queries
├── hooks/                       # Custom React hooks
├── lib/                         # Client-side utilities
└── types/                       # TypeScript type definitions
```

## Database Schema
Key entities in the PostgreSQL database:

### Core Tables
- **users**: User accounts with wallet addresses, admin/whitelist status
- **artists**: Main artist records with social media links and metadata
- **ugcresearch**: User-generated content submissions pending approval
- **urlmap**: Platform configuration and URL patterns for link validation
- **featured**: Featured artists and collectors
- **coverageReports**: Test coverage tracking
- **aiPrompts**: AI prompt templates for content generation
- **funFacts**: AI-generated fun facts about artists

### Important Relationships
- Artists are linked to users via `addedBy` (foreign key to users.id)
- UGC submissions reference both artist and user
- Platform links are validated against urlmap regex patterns

## Authentication System
- **Web3-First**: Uses SIWE (Sign-In with Ethereum) for wallet-based authentication
- **NextAuth Integration**: Custom credentials provider for wallet verification
- **Role-Based Access**: Admin and whitelist user roles
- **Guest Mode**: Optional wallet requirement bypass for development
- **Session Management**: JWT-based sessions with 30-day expiry

## API Endpoints
Key API routes in `src/app/api/`:
- `/searchArtists` - Artist search with Spotify integration
- `/validateLink` - Platform link validation
- `/artistBio/[id]` - AI-generated artist biographies
- `/funFacts/[type]` - AI-generated fun facts
- `/leaderboard` - User contribution rankings
- `/admin/*` - Admin management endpoints

## Development Workflow

### Available Scripts
```bash
npm run dev          # Start development server with HTTPS
npm run build        # Production build
npm run test         # Run Jest tests
npm run test:coverage # Test coverage report
npm run lint         # ESLint
npm run type-check   # TypeScript checking
npm run ci           # Full CI pipeline (type-check + lint + test + build)
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
- `OPENAI_API_KEY` - For AI features
- `DISCORD_WEBHOOK_URL` - UGC notifications

## Key Components

### Artist Management
- `src/app/artist/[id]/page.tsx` - Artist detail pages
- `src/app/_components/ArtistLinks.tsx` - Social media link display
- `src/server/utils/queries/artistQueries.ts` - Database queries

### Authentication Flow
- `src/server/auth.ts` - NextAuth configuration with SIWE
- `src/app/_components/nav/components/Login.tsx` - Login UI
- Web3 wallet connection via RainbowKit

### Search Functionality
- `src/app/_components/nav/components/SearchBar.tsx` - Search interface
- `src/app/api/searchArtists/route.ts` - Combined DB + Spotify search

## Testing Strategy
- **Unit Tests**: Component and utility testing with Jest
- **API Tests**: Route handler testing
- **Coverage**: Comprehensive test coverage reporting
- **CI/CD**: GitHub Actions with automated testing

## Code Quality Tools
- **ESLint**: Code linting with Next.js config
- **TypeScript**: Strict type checking
- **Prettier**: Code formatting (implied via package structure)
- **Coverage Reports**: Jest coverage with Discord notifications

## Important Notes for Claude
1. **Web3 Context**: This is a Web3-enabled application requiring wallet connections
2. **Role-Based Features**: Many features require admin or whitelist privileges
3. **External Dependencies**: Heavy integration with Spotify API and OpenAI
4. **Database First**: Most data operations go through Drizzle ORM queries
5. **Type Safety**: Strict TypeScript usage throughout the codebase
6. **Testing Required**: Always run tests after code changes
7. **Environment Dependent**: Many features require proper env variable configuration

## Recent Development Focus
Based on git history, recent work includes:
- YouTube URL handling refactor (see `plans/youtube-url-refactor-plan.md`)
- Leaderboard improvements and UX enhancements
- Database schema optimizations for user-generated content

## Commands to Run After Changes
```bash
npm run type-check && npm run lint && npm run test && npm run build
```