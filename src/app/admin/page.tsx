import { getServerAuthSession } from "@/server/auth";
import { redirect } from "next/navigation";
import { getUserById, getAllUsers } from "@/server/utils/queries/userQueries";
import { getPendingUGC } from "@/server/utils/queries/artistQueries";
import { getAllClaims } from "@/server/utils/queries/dashboardQueries";
import { getAllMcpKeys } from "@/server/utils/queries/mcpKeyQueries";
import UGCDataTable from "./ugc-data-table";
import { ugcColumns, whitelistedColumns } from "./columns";
import ClaimsDataTable from "./claims-data-table";
import { claimsColumns } from "./claims-columns";
import type { ClaimRow } from "./claims-columns";
import UsersSection from "./UsersSection";
import AdminTabs from "./AdminTabs";
import McpKeysSection from "./McpKeysSection";
import AgentWorkSection from "./AgentWorkSection";
import ArtistDataSection from "./ArtistDataSection";

export default async function Admin() {
  const session = await getServerAuthSession();

  if (!session) {
    redirect('/');
  }

  const user = await getUserById(session.user.id);
  if (!user?.isAdmin) {
    redirect('/');
  }

  const [pendingUGCData, allUsers, mcpKeys, rawClaims] = await Promise.all([
    getPendingUGC(),
    getAllUsers(),
    getAllMcpKeys(),
    getAllClaims(),
  ]);

  const allClaims: ClaimRow[] = rawClaims.map((claim) => ({
    id: claim.id,
    status: claim.status,
    referenceCode: claim.referenceCode,
    artistName: claim.artist?.name ?? "Unknown Artist",
    artistId: claim.artistId,
    artistInstagram: claim.artist?.instagram ?? null,
    userEmail: claim.user?.email ?? null,
    userName: claim.user?.username ?? null,
    createdAt: claim.createdAt,
  }));

  const pendingClaimsCount = allClaims.filter(c => c.status === "pending").length;

  return (
    <section className="admin-page px-4 sm:px-10 py-5 space-y-6">
      <h1 className="text-3xl font-bold text-center mb-8">Admin Dashboard</h1>

      <AdminTabs
        ugcCount={pendingUGCData.length}
        claimsCount={pendingClaimsCount}
        ugcContent={
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-[#9b83a0]">
              Pending UGC Submissions ({pendingUGCData.length})
            </h2>
            <UGCDataTable columns={ugcColumns} data={pendingUGCData} />
          </div>
        }
        claimsContent={
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-[#9b83a0]">
              Artist Claims ({allClaims.length})
            </h2>
            <ClaimsDataTable columns={claimsColumns} data={allClaims} />
          </div>
        }
        usersContent={
          <UsersSection columns={whitelistedColumns} data={allUsers || []} />
        }
        mcpKeysContent={
          <McpKeysSection initialKeys={mcpKeys} />
        }
        agentWorkContent={
          <AgentWorkSection />
        }
        artistDataContent={
          <ArtistDataSection />
        }
      />
    </section>
  );
}
