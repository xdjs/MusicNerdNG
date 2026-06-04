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

/** @deprecated Use getSupabaseAdmin() instead — kept for existing imports */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
    get(_, prop) {
        return (getSupabaseAdmin() as unknown as Record<string | symbol, unknown>)[prop];
    },
});

export const VAULT_BUCKET = "vault-files";
