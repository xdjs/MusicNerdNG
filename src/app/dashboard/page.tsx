import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { getApprovedClaimByUserId } from "@/server/utils/queries/dashboardQueries";

// The standalone dashboard was folded into the artist profile's edit mode.
// This route is kept only as a redirect so old bookmarks/links don't 404:
// claimed owners land on their artist profile, everyone else on home.
export const dynamic = "force-dynamic";

export default async function DashboardRedirect() {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (session?.user?.id) {
        const claim = await getApprovedClaimByUserId(session.user.id);
        if (claim?.artistId) redirect(`/artist/${claim.artistId}`);
    }
    redirect("/");
}
