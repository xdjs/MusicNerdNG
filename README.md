# MusicNerdNG

A comprehensive, crowd-sourced music artist directory and discovery platform built with Next.js. MusicNerdNG allows users to discover, track, and manage music artists across multiple platforms including Spotify, social media, and Web3 platforms.

## 🎵 Features

### Core Functionality
- **Artist Discovery**: Search and discover artists from Spotify's vast catalog
- **Multi-Platform Integration**: Connect artists across Spotify, social media, and Web3 platforms
- **Crowd-Sourced Data**: Community-driven artist information and link validation
- **Real-time Search**: Instant search results combining local database and Spotify API
- **Artist Profiles**: Comprehensive artist pages with social links and platform integrations

### Authentication & Security
- **Web3 Wallet Authentication**: Secure login using Ethereum wallets and SIWE (Sign-In with Ethereum)
- **NextAuth.js Integration**: Robust session management and authentication flows
- **Role-Based Access**: Admin and whitelisted user management
- **CSRF Protection**: Built-in security against cross-site request forgery

### Platform Integrations
- **Spotify API**: Artist data, images, and metadata
- **Social Media**: Twitter/X, Instagram, YouTube, TikTok, Facebook
- **Music Platforms**: SoundCloud, Bandcamp, Audius, Last.fm
- **Web3 Platforms**: OpenSea, Zora, Catalog, SuperCollector, MintSongs
- **Blockchain**: ENS (Ethereum Name Service) and wallet address support

### Developer Experience
- **TypeScript**: Full type safety and IntelliSense support
- **Modern Stack**: Next.js 14, Tailwind CSS, Drizzle ORM
- **Testing**: Comprehensive Jest test suite with coverage reporting
- **CI/CD**: Automated testing and deployment pipelines

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18 or later
- **npm** or **yarn** package manager
- **PostgreSQL** database (Supabase recommended)
- **Spotify Developer Account** for API access
- **OpenAI API Key** for AI-powered features

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/xdjs/MusicNerdNG.git
   cd MusicNerdNG
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` with your configuration:
   ```bash
   # Spotify API Credentials
   NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID=your_spotify_client_id
   NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET=your_spotify_client_secret

   # Database Configuration
   SUPABASE_DB_CONNECTION=your_supabase_connection_string

   # Authentication
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=your_nextauth_secret

   # AI Services
   OPENAI_API_KEY=your_openai_api_key

   # Optional: Discord Integration
   DISCORD_WEBHOOK_URL=your_discord_webhook_url
   DISCORD_COVERAGE_URL=your_coverage_webhook_url
   ```

4. **Set up the database**
   ```bash
   npm run db:generate
   npm run db:push
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## 🛠️ Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with HTTPS |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint for code quality |
| `npm run type-check` | Run TypeScript type checking |
| `npm run test` | Run Jest test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run ci` | Run all checks (types, lint, tests, build) |
| `npm run db:generate` | Generate database migrations |
| `npm run db:push` | Push schema changes to database |
| `npm run db:studio` | Open Drizzle Studio |

## 🧪 Testing

The project includes a comprehensive test suite:

```bash
# Run all tests
npm run test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

Test coverage includes:
- Unit tests for utilities and components
- Integration tests for API routes
- Authentication flow testing
- Database query testing

## 📚 API Documentation

For detailed API documentation, see [ApiReadMe.md](./ApiReadMe.md).

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS, Radix UI components
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: NextAuth.js with SIWE (Sign-In with Ethereum)
- **Web3**: RainbowKit, Wagmi, Ethers.js
- **Testing**: Jest, React Testing Library
- **State Management**: React Query (TanStack Query)
- **Deployment**: Vercel-ready configuration

### Key Features
- **Server-Side Rendering**: Optimized for SEO and performance
- **Type Safety**: Full TypeScript implementation
- **Responsive Design**: Mobile-first approach
- **Progressive Enhancement**: Works without JavaScript
- **Security**: CSRF protection, input validation, secure headers

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines for details.

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

## 🆘 Support

For support, please open an issue on GitHub or contact the development team.

