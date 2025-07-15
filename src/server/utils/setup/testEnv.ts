/**
 * Test environment setup
 * This file sets up environment variables and imports necessary polyfills for testing.
 * It should be imported at the beginning of test setup.
 */

// Helper to check if we're in CI environment
export const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

// Helper to check if we're in test environment
export const isTest = process.env.NODE_ENV === 'test';

// Helper to check if required env vars are present
export const hasSpotifyCredentials = Boolean(
    process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID &&
    process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET
) || isTest;

// Set up test environment variables with fallback values
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID = (process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID || (isTest ? 'test-spotify-client-id' : '')) as string;
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET = (process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET || (isTest ? 'test-spotify-client-secret' : '')) as string;
process.env.SUPABASE_DB_CONNECTION = process.env.SUPABASE_DB_CONNECTION || 'postgresql://postgres:postgres@db.supabase.co:5432/postgres';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret-for-testing';
process.env.DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'test-discord-webhook';

// Import polyfills
import './polyfills'; 