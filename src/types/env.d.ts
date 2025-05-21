declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID: string;
    NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET: string;
    SUPABASE_DB_CONNECTION: string;
    NEXTAUTH_URL: string;
    DISCORD_WEBHOOK_URL: string;
    GEMINI_API_KEY: string;
  }
} 