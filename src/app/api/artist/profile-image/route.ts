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

        return NextResponse.json({ success: true, imagePath: publicUrl });
    } catch (error) {
        console.error("[artist/profile-image] Error:", error);
        return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
    }
}
