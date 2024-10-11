import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/schema/*",
  out: "./drizzle",
  dialect: 'postgresql',
  dbCredentials: {
    url: "postgresql://postgres.kyhlkqriyvevjqtufidu:carlloveshentai123@aws-0-us-west-1.pooler.supabase.com:5432/postgres",
  }
});