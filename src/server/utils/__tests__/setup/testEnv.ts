// Set up test environment variables BEFORE any imports
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID || 'test-spotify-client-id';
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET = process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET || 'test-spotify-client-secret';
process.env.SUPABASE_DB_CONNECTION = process.env.SUPABASE_DB_CONNECTION || 'postgresql://postgres:postgres@db.supabase.co:5432/postgres';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
process.env.DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'test-discord-webhook';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-api-key';

// Now import polyfills and other setup
import './polyfills'; 