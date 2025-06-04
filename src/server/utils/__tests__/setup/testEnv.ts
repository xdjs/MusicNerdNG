import './polyfills';

// Set up test environment variables
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID = 'test-spotify-client-id';
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET = 'test-spotify-client-secret';
process.env.SUPABASE_DB_CONNECTION = process.env.SUPABASE_DB_CONNECTION || 'postgresql://postgres:postgres@db.supabase.co:5432/postgres';
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.DISCORD_WEBHOOK_URL = 'test-discord-webhook';
process.env.GEMINI_API_KEY = 'test-gemini-api-key'; 