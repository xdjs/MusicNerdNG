"use server"

import { NextResponse } from "next/server";
import { removeArtistData } from "@/server/utils/queries/artistQueries";
import { getServerAuthSession } from "@/server/auth";

const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';

export async function POST(req: Request) {
    try {
        const session = await getServerAuthSession();
        if (!session && !walletlessEnabled) {
            return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
        }

        const { artistId, siteName } = await req.json();
        if (!artistId || !siteName) return NextResponse.json({ message: "Missing parameters" }, { status: 400 });

        const resp = await removeArtistData(artistId as string, siteName as string);
        if (resp.status === "error") {
            return NextResponse.json({ message: resp.message }, { status: 403 });
        }
        return NextResponse.json({ message: resp.message });
    } catch (e) {
        console.error("API removeArtistData error", e);
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
} 