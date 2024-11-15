import { getServerAuthSession } from "@/server/auth";
import { getUserById, getPendingUGC } from "@/server/utils/queriesTS";
import { notFound } from "next/navigation";
import UGCDataTable from "./ugc-data-table";        
import { ugcColumns } from "./columns";
import { getWhitelistedUsers } from "@/server/utils/queriesTS";
import { whitelistedColumns } from "./columns";
import WhitelistedDataTable from "./whitelisted-data-table";

export default async function Admin() {
    const session = await getServerAuthSession();
    const user = session?.user;
    if (!user) return notFound();
    const userRecord = await getUserById(user.id);
    if (!userRecord || !userRecord.isAdmin) return notFound();
    const pendingUGCData = await getPendingUGC();
    const whitelistedUsers = await getWhitelistedUsers();
    return (
        <section className="px-10 py-5 space-y-6">
            <h1 className="text-2xl">Site Management</h1>
            <div>
                <h2 className="text-xl pb-3">Pending UGC</h2>
                <UGCDataTable columns={ugcColumns} data={pendingUGCData} />
            </div>
            <div>
                <h2 className="text-xl pb-3">Whitelisted Users</h2>
                <WhitelistedDataTable columns={whitelistedColumns} data={whitelistedUsers} />
            </div>
        </section>
    );
}