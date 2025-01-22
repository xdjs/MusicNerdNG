import { getServerAuthSession } from "@/server/auth";
import Dashboard from "./Dashboard";
import { notFound } from "next/navigation";
import { getUserById } from "@/server/utils/queriesTS";
import Login from "../_components/nav/components/Login";

export default async function Page() {
    const session = await getServerAuthSession();
    if (!session) {
        return (
            <section className="px-10 py-5 space-y-6 flex flex-col items-center justify-center">
                <p>Login to view UGC Stats</p>
                <Login buttonStyles="bg-blue-500 text-white" />
            </section>
        )
    }
    const user = await getUserById(session.user.id);
    if (!user) {
        return notFound();
    }
    return <Dashboard user={user} />;
}
