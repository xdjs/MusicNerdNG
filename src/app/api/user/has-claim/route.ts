import { getServerAuthSession } from "@/server/auth";
import { getApprovedClaimByUserId } from "@/server/utils/queries/dashboardQueries";

export const dynamic = "force-dynamic";

export async function GET() {
    const start = performance.now();
    try {
        const session = await getServerAuthSession();
        if (!session?.user?.id) {
            return Response.json({ hasClaim: false, artistId: null });
        }

        const claim = await getApprovedClaimByUserId(session.user.id);
        return Response.json({ hasClaim: !!claim, artistId: claim?.artistId ?? null });
    } catch {
        return Response.json({ hasClaim: false, artistId: null });
    } finally {
        console.debug(`[has-claim] GET took ${performance.now() - start}ms`);
    }
}
