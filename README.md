# MusicNerdNG

MusicNerdNG is a Next.js application that provides artist discovery and management features, integrating with Spotify and other social media platforms.

## Features

- **Artist Discovery**: Search and explore artists from various platforms
- **Spotify Integration**: Rich artist data, images, and music embeds
- **Social Media Aggregation**: Collect and display artist links from multiple platforms
- **AI-Powered Content**: Auto-generated artist bios and fun facts using OpenAI
- **Web3 Integration**: Wallet-based authentication and ENS support
- **User Management**: Role-based access control and whitelisting
- **Real-time Search**: Fast, debounced search with combined local and Spotify results
- **Responsive Design**: Mobile-first UI with modern components

## Prerequisites

- Node.js 18 or later
- npm
- PostgreSQL database (Supabase)
- Spotify Developer Account
- OpenAI Account (for AI features like bio generation and fun facts)

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```bash
# Spotify API Credentials
NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID=your_spotify_client_id
NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET=your_spotify_client_secret

# Database
SUPABASE_DB_CONNECTION=your_supabase_connection_string

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret

# Discord Integration for UGC notifications
DISCORD_WEBHOOK_URL=your_discord_webhook_url

# OpenAI API (for AI features like bio generation and fun facts)
OPENAI_API_KEY=your_openai_api_key

# Optional: Coverage reporting webhook
DISCORD_COVERAGE_URL=your_discord_coverage_webhook_url

# Optional: Disable wallet requirement for development
NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT=false
```

**Note**: You can also copy `.env.example` to `.env.local` and fill in your values.

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/xdjs/MusicNerdNG.git
cd MusicNerdNG
```

2. Install dependencies:
```bash
npm install
```

3. Set up your environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your actual values
```

4. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Available Scripts

### Development
- `npm run dev` - Start development server with HTTPS
- `npm run build` - Build for production
- `npm run start` - Start production server

### Code Quality
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking
- `npm run ci` - Run all checks (types, lint, tests, build)

### Testing
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run test:ci` - Run tests with coverage for CI

## API Documentation

For detailed API documentation, see [ApiReadMe.md](./ApiReadMe.md).

## Testing

The project uses Jest for testing. Run tests with:

```bash
npm run test
```

For test coverage:

```bash
npm run test:coverage
```

## Tech Stack

- **Framework**: Next.js 14
- **Language**: TypeScript
- **Styling**: Tailwind CSS + SCSS
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: NextAuth.js + RainbowKit
- **AI**: OpenAI API
- **Testing**: Jest with React Testing Library
- **State Management**: React Query
- **UI Components**: Radix UI + Custom components
- **Web3**: Wagmi + RainbowKit + SIWE

## License

This project is licensed under the [MIT License](./LICENSE).

