import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { insertVaultSource } from "@/server/utils/queries/dashboardQueries";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import { supabaseAdmin, VAULT_BUCKET } from "@/server/lib/supabase";
import { validateMagicBytes } from "@/server/utils/validateMagicBytes";
import { extractPdfText } from "@/server/utils/extractPdfText";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
    "image/webp",
    "audio/mpeg",
    "audio/wav",
];

const MIME_EXT_MAP: Record<string, string> = {
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
};

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
            console.error("[vault/upload] rejected:", { name: file.name, type: file.type, size: file.size, reason: "too_large" });
            return NextResponse.json(
                { error: `File too large: ${formatFileSize(file.size)} (max 10MB)` },
                { status: 400 }
            );
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            console.error("[vault/upload] rejected:", { name: file.name, type: file.type, size: file.size, reason: "unsupported_type" });
            return NextResponse.json(
                { error: `File type not supported: "${file.type || "unknown"}". Supported: PDF, TXT, MD, CSV, JSON, DOCX, images, audio.` },
                { status: 400 }
            );
        }

        // Read file into buffer
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Validate magic bytes for binary formats to prevent MIME type spoofing
        if (!validateMagicBytes(buffer, file.type)) {
            console.error("[vault/upload] rejected:", {
                name: file.name,
                type: file.type,
                size: file.size,
                reason: "magic_byte_mismatch",
                header: Array.from(buffer.subarray(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(" "),
            });
            return NextResponse.json(
                { error: "File content does not match declared type" },
                { status: 400 }
            );
        }

        // All ALLOWED_TYPES have entries in MIME_EXT_MAP; fallback is safety-net only
        const ext = MIME_EXT_MAP[file.type] ?? "";
        const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
        const storagePath = `${artistId}/${Date.now()}_${baseName}${ext}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabaseAdmin.storage
            .from(VAULT_BUCKET)
            .upload(storagePath, buffer, { contentType: file.type });

        if (uploadError) {
            console.error("[vault/upload] Supabase upload error:", uploadError);
            return NextResponse.json({ error: "Failed to upload file to storage" }, { status: 500 });
        }

        // Get public URL
        const { data: urlData } = supabaseAdmin.storage
            .from(VAULT_BUCKET)
            .getPublicUrl(storagePath);
        const publicUrl = urlData.publicUrl;

        // Extract text content for LLM access (bio + funFacts + askArtist context)
        let extractedText: string | undefined;
        if (
            file.type === "text/plain" ||
            file.type === "text/markdown" ||
            file.type === "text/csv" ||
            file.type === "application/json"
        ) {
            extractedText = new TextDecoder().decode(bytes);
        } else if (file.type === "application/pdf") {
            extractedText = (await extractPdfText(buffer)) ?? undefined;
            if (!extractedText) {
                console.warn(`[vault/upload] No text extracted from PDF "${file.name}" (image-only or empty?)`);
            }
        }

        // Insert vault source record
        const source = await insertVaultSource({
            artistId,
            url: publicUrl,
            title: file.name,
            snippet: extractedText ? extractedText.slice(0, 300) : `Uploaded file: ${file.name} (${formatFileSize(file.size)})`,
            type: getSourceType(file.type),
            status: "approved",
            fileName: file.name,
            fileSize: file.size,
            filePath: publicUrl,
            contentType: file.type,
            extractedText: extractedText ?? null,
        });

        return NextResponse.json({ success: true, source });
    } catch (error) {
        console.error("[vault/upload] Error:", error);
        return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
    }
}

function getSourceType(mimeType: string): string {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType === "application/pdf") return "document";
    if (mimeType.includes("word")) return "document";
    if (mimeType === "text/plain" || mimeType === "text/markdown") return "document";
    if (mimeType === "text/csv" || mimeType === "application/json") return "data";
    return "document";
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
