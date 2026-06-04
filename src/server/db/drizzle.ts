import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema'
import { SUPABASE_DB_CONNECTION } from '@/env';

const connectionString = SUPABASE_DB_CONNECTION

// Reuse the client across hot reloads in development to prevent connection pool exhaustion
const globalForDb = globalThis as unknown as { pgClient: ReturnType<typeof postgres> | undefined };

const client = globalForDb.pgClient ?? postgres(connectionString, { prepare: false });

if (process.env.NODE_ENV !== 'production') {
    globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });
