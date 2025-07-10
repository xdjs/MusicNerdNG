# MusicNerdNG

MusicNerdNG is a Next.js application that provides artist discovery and management features, integrating with Spotify and other social media platforms.

## Features

- Artist discovery and search
- Spotify integration
- Social media handle lookup
- Artist management
- Authentication with NextAuth.js
- Web3 wallet integration

## Prerequisites

- Node.js 18 or later
- npm
- PostgreSQL database (Supabase)
- Spotify Developer Account
- Google Cloud Account (for Gemini AI)

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

# Discord Integration
DISCORD_WEBHOOK_URL=your_discord_webhook_url

# Google AI
GEMINI_API_KEY=your_gemini_api_key
```

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

3. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Available Scripts

- `npm run dev` - Start development server with HTTPS
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run type-check` - Run TypeScript type checking
- `npm run ci` - Run all checks (types, lint, tests, build)

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

- Next.js 14
- TypeScript
- Tailwind CSS
- Drizzle ORM
- NextAuth.js
- RainbowKit
- Jest
- React Query
- Radix UI

## License

This project is licensed under the [MIT License](./LICENSE).

