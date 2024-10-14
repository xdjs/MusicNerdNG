import { defineConfig } from "drizzle-kit";
import {SUPABASE_DB_CONNECTION } from "@/env";

export default defineConfig({
  schema: "./src/schema/*",
  out: "./drizzle",
  dialect: 'postgresql',
  dbCredentials: {
    url: SUPABASE_DB_CONNECTION,
  }
});