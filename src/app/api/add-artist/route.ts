import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { addArtist } from "@/server/utils/queriesTS";

export async function POST(request: Request) {
    console.log("[Server] Add Artist API route called");
    
    const session = await getServerSession(authOptions);
    if (!session) {
        console.log("[Server] No session in API route");
        return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
        const { spotifyId } = await request.json();
        console.log("[Server] Processing artist addition for:", spotifyId);
        
        if (!spotifyId) {
            return Response.json({ error: "No spotify ID provided" }, { status: 400 });
        }

        const result = await addArtist(spotifyId);
        console.log("[Server] Add artist result:", result);
        
        return Response.json(result);
    } catch (error) {
        console.error("[Server] Error in add artist API route:", error);
        return Response.json({ error: "Server error" }, { status: 500 });
    }
} 