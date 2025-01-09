import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema'
import { SUPABASE_DB_CONNECTION } from '@/env';

        
const connectionString = SUPABASE_DB_CONNECTION

// Disable prefetch as it is not supported for "Transaction" pool mode 
const client = postgres(connectionString, { prepare: false })

export const db = drizzle(client, {schema});

