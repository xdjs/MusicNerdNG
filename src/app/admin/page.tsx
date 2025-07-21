import { getServerAuthSession } from "@/server/auth";
import { getUserById, getAllUsers } from "@/server/utils/queries/userQueries";
import { getPendingUGC } from "@/server/utils/queries/artistQueries";
import UGCDataTable from "./ugc-data-table";        
import { ugcColumns } from "./columns";
import { whitelistedColumns } from "./columns";
import UsersDataTable from "./whitelisted-data-table";
import PleaseLoginPage from "@/app/_components/PleaseLoginPage";

export default async function Admin() {
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';

    let isAuthorized = false;
    let userId: string | undefined;

    if (walletlessEnabled) {
        // Local dev shortcut – treat as admin without auth.
        isAuthorized = true;
    } else {
        const session = await getServerAuthSession();
        const user = session?.user;
        if (!user) return <PleaseLoginPage text="Log in to access this page" />;
        userId = user.id;
        const userRecord = await getUserById(userId);
        if (!userRecord || !userRecord.isAdmin) return <PleaseLoginPage text="You are not authorized to access this page" />;
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return <PleaseLoginPage text="You are not authorized to access this page" />;
    }

    const [pendingUGCData, allUsers] = await Promise.all([
        getPendingUGC(),
        getAllUsers(),
    ]);

    return (
        <section className="px-10 py-5 space-y-6">
            <h1 className="text-2xl">Site Management</h1>
            <div>
                <h2 className="text-xl pb-3">Pending UGC</h2>
                <UGCDataTable columns={ugcColumns} data={pendingUGCData} />
            </div>
            <div>
                <h2 className="text-xl pb-3">Users</h2>
                <UsersDataTable columns={whitelistedColumns} data={allUsers || []} />
            </div>
        </section>
    );
}