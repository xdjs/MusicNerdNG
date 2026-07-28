import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/env";

let _supabaseAdmin: SupabaseClient | null = null;

/** Lazily initialized so the build doesn't crash when env vars are missing */
export function getSupabaseAdmin(): SupabaseClient {
    if (!_supabaseAdmin) {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
        }
        _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false },
        });
    }
    return _supabaseAdmin;
}

/**
 * Whether Supabase Storage is usable in this environment. Returns false when the
 * service-role credentials are absent — the common deploy misconfiguration where
 * `SUPABASE_DB_CONNECTION` is set (so DB-only features work) but the storage vars
 * are not, so every upload throws a generic 500. Routes call this to fail fast
 * with a clear "storage not configured" message instead.
 */
export function isSupabaseStorageConfigured(): boolean {
    return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/** @deprecated Use getSupabaseAdmin() instead — kept for existing imports */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
    get(_, prop) {
        return (getSupabaseAdmin() as unknown as Record<string | symbol, unknown>)[prop];
    },
});

export const VAULT_BUCKET = "vault-files";
