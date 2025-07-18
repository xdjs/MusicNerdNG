// Validate required environment variables
function validateEnv<T extends string>(value: T | undefined, name: string, isTest = false): T {
    if (!value) {
        if (isTest) {
            return 'test-value' as T;
        }
        throw new Error(`${name} environment variable is required`);
    }
    return value;
}

// Check if we're in a test environment
const isTestEnv = process.env.NODE_ENV === 'test';

export const SPOTIFY_WEB_CLIENT_ID = validateEnv(process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID, 'NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID', isTestEnv);
export const SPOTIFY_WEB_CLIENT_SECRET = validateEnv(process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET, 'NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET', isTestEnv);
export const SUPABASE_DB_CONNECTION = process.env.SUPABASE_DB_CONNECTION ?? "";
export const NEXTAUTH_URL = process.env.NEXTAUTH_URL ?? "";
export const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";
export const OPENAI_API_KEY = validateEnv(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY', isTestEnv);
