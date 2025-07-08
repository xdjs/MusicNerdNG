"use server"

import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { addArtistData, getArtistById } from "@/server/utils/queriesTS";

const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';

export async function POST(req: Request) {
    try {
        const session = await getServerAuthSession();
        if (!session && !walletlessEnabled) {
            return NextResponse.json({ status: "error", message: "Not authenticated" }, { status: 401 });
        }

        const { artistId, artistUrl } = await req.json();
        if (!artistId || !artistUrl) {
            return NextResponse.json({ status: "error", message: "Missing parameters" }, { status: 400 });
        }

        const artist = await getArtistById(artistId as string);
        if (!artist) {
            return NextResponse.json({ status: "error", message: "Artist not found" }, { status: 404 });
        }

        const resp = await addArtistData(artistUrl as string, artist);
        const statusCode = resp.status === "success" ? 200 : 403;
        return NextResponse.json(resp, { status: statusCode });
    } catch (e) {
        console.error("API addArtistData error", e);
        return NextResponse.json({ status: "error", message: "Internal server error" }, { status: 500 });
    }
} 