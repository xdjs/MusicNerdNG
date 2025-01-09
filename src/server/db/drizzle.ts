import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema'
import { SUPABASE_DB_CONNECTION } from '@/env';

        
const connectionString ="postgresql://postgres.cbabvmebugudeuylronz:CarlAgressivlyLovesHentai123@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

// Disable prefetch as it is not supported for "Transaction" pool mode 
const client = postgres(connectionString, { prepare: false })

export const db = drizzle(client, {schema});

