// Validate required environment variables
function validateEnv<T extends string>(value: T | undefined, name: string): T {
    if (!value) {
        throw new Error(`${name} environment variable is required`);
    }
    return value;
}

export const SPOTIFY_WEB_CLIENT_ID = validateEnv(process.env.SPOTIFY_WEB_CLIENT_ID, 'SPOTIFY_WEB_CLIENT_ID');
export const SPOTIFY_WEB_CLIENT_SECRET = validateEnv(process.env.SPOTIFY_WEB_CLIENT_SECRET, 'SPOTIFY_WEB_CLIENT_SECRET');
export const SUPABASE_DB_CONNECTION = process.env.SUPABASE_DB_CONNECTION ?? "";
export const NEXTAUTH_URL = process.env.NEXTAUTH_URL ?? "";
export const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
