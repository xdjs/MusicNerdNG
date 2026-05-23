import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { getApprovedClaimByUserId } from "@/server/utils/queries/dashboardQueries";
import { getUserById } from "@/server/utils/queries/userQueries";
import { supabaseAdmin, VAULT_BUCKET } from "@/server/lib/supabase";
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

        const claim = await getApprovedClaimByUserId(session.user.id);
        const ownsTarget = claim?.artistId === artistId;
        if (!ownsTarget) {
            const user = await getUserById(session.user.id);
            if (!user?.isAdmin) {
                return NextResponse.json(
                    { error: claim ? "Not authorized for this artist" : "No claimed artist profile" },
                    { status: 403 }
                );
            }
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
