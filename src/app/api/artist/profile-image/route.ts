import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import { supabaseAdmin, VAULT_BUCKET } from "@/server/lib/supabase";
import { validateMagicBytes } from "@/server/utils/validateMagicBytes";
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function POST(req: Request) {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const artistId = formData.get("artistId") as string | null;

        if (!file || !artistId) {
            return NextResponse.json({ error: "File and artistId are required" }, { status: 400 });
        }

        if (!(await canEditArtist(session.user.id, artistId))) {
            return NextResponse.json({ error: "Not authorized for this artist" }, { status: 403 });
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 400 });
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json(
                { error: "Only PNG, JPEG, and WebP images are supported" },
                { status: 400 }
            );
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Validate magic bytes — a client can declare image/png on a non-PNG payload.
        // This URL ends up in artists.customImage and is served publicly, so consistency
        // with the vault/upload path matters.
        if (!validateMagicBytes(buffer, file.type)) {
            console.error("[artist/profile-image] rejected:", {
                name: file.name,
                type: file.type,
                size: file.size,
                reason: "magic_byte_mismatch",
                header: Array.from(buffer.subarray(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(" "),
            });
            return NextResponse.json(
                { error: "Image content does not match declared type" },
                { status: 400 }
            );
        }

        const extByMime: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
        const ext = extByMime[file.type] ?? ".bin";
        const storagePath = `profile-images/${artistId}_${Date.now()}${ext}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabaseAdmin.storage
            .from(VAULT_BUCKET)
            .upload(storagePath, buffer, { contentType: file.type });

        if (uploadError) {
            console.error("[artist/profile-image] Supabase upload error:", uploadError);
            return NextResponse.json({ error: "Failed to upload image to storage" }, { status: 500 });
        }

        // Get public URL
        const { data: urlData } = supabaseAdmin.storage
            .from(VAULT_BUCKET)
            .getPublicUrl(storagePath);
        const publicUrl = urlData.publicUrl;

        // Update the artist record with the Supabase image URL
        await db
            .update(artists)
            .set({ customImage: publicUrl })
            .where(eq(artists.id, artistId));

        // Best-effort: purge older profile images for this artist now that the new
        // one is live. Without this, every save accumulates an orphaned object
        // (revokeClaimAction is the only other purge path). Runs AFTER the artist
        // row is updated so a purge failure can't leave the user with a deleted
        // image but the DB still pointing at it.
        try {
            // storagePath always starts with "profile-images/" (constructed above),
            // so this strips to the bare filename Supabase list() returns.
            const filename = storagePath.replace(/^profile-images\//, "");
            const { data: files } = await supabaseAdmin.storage
                .from(VAULT_BUCKET)
                .list("profile-images", { limit: 1000, offset: 0, search: `${artistId}_` });
            // Defense in depth: `search` is substring match — re-anchor with startsWith.
            // Exclude the file we just uploaded AND anything uploaded in the last 30s,
            // so two concurrent uploads from the same owner can't have one nuke the
            // other's just-uploaded storage object before its DB update lands.
            const concurrentGraceMs = 30_000;
            const ageCutoff = Date.now() - concurrentGraceMs;
            const stale = (files ?? [])
                .filter(f => {
                    if (!f.name.startsWith(`${artistId}_`)) return false;
                    if (f.name === filename) return false;
                    // Supabase FileObject exposes `created_at` (ISO 8601) — type-guard
                    // it explicitly so a future shape change drops to the safe "skip"
                    // branch instead of silently bypassing the grace check.
                    const createdAt = "created_at" in f && typeof f.created_at === "string"
                        ? f.created_at
                        : null;
                    if (!createdAt) return false;
                    const parsed = Date.parse(createdAt);
                    if (Number.isNaN(parsed)) return false;
                    return parsed < ageCutoff;
                })
                .map(f => `profile-images/${f.name}`);
            if (stale.length > 0) {
                const { error: removeError } = await supabaseAdmin.storage
                    .from(VAULT_BUCKET)
                    .remove(stale);
                if (removeError) {
                    console.error("[artist/profile-image] Stale image purge failed:", removeError);
                } else {
                    console.log(`[artist/profile-image] Purged ${stale.length} stale image(s) for artist ${artistId}`);
                }
            }
        } catch (e) {
            console.error("[artist/profile-image] Stale image cleanup error:", e);
        }

        return NextResponse.json({ success: true, imagePath: publicUrl });
    } catch (error) {
        console.error("[artist/profile-image] Error:", error);
        return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
    }
}
