import { getServerAuthSession } from "@/server/auth";
import { getUserById, getPendingUGC } from "@/server/utils/queriesTS";
import { notFound } from "next/navigation";
import { UgcResearch } from "@/server/db/DbTypes";
import { DataTable } from "./data-table";
import { columns } from "./columns";

export default async function Admin() {
    const session = await getServerAuthSession();
    const user = session?.user;
    if (!user) return notFound();
    const userRecord = await getUserById(user.id);
    if (!userRecord || !userRecord.isAdmin) return notFound();

    const getPendingUGCData = await getPendingUGC();
    return (
        <section className="px-10 py-5 space-y-6">
            <h1 className="text-2xl">Site Management</h1>
            <div>
                <h2 className="text-xl pb-3">Pending UGC</h2>
                <DataTable columns={columns} data={getPendingUGCData} />
            </div>
        </section>
    );
}